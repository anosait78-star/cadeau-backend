import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { KeysetPage } from "@cadeau/database";
import { AccessResolverService } from "../../../shared/access/access-resolver.service";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppErrors, AppException } from "../../../shared/errors/app-exception";
import { EVENT_BUS, type EventBusPort } from "../../../shared/events/event-bus.port";
import { CLOCK, type Clock } from "../../../shared/time/clock";
import type {
  BulkItemResult,
  OrderActivityView,
  OrderListView,
  OrderView,
  StatusChangeResult,
} from "../domain/order.entity";
import type { OrderStatus } from "../domain/order-status";
import { IMPORT_MAX_ROWS, mapImport, parseCsv, type ImportMapping } from "../domain/csv-import";
import { parsePaste, type ParsedDraft } from "../domain/smart-paste";
import {
  parseOrderListQuery,
  type ParsedOrderListQuery,
  type RawOrderListQuery,
} from "../domain/list-query";
import { ORDERS_AUDIT, type OrdersAuditPort } from "../domain/orders-audit.port";
import {
  ORDERS_REPOSITORY,
  type CreateOrderInput,
  type OrdersRepositoryPort,
  type TransitionInput,
  type UpdateOrderInput,
  type WriteActor,
} from "../domain/orders-repository.port";
import {
  DuplicateOrderError,
  EmptyOrderError,
  IllegalTransitionError,
  InsufficientStockError,
  InvalidAmountError,
  InvalidListCursorError,
  ReasonRequiredError,
  ReferenceNotFoundError,
} from "../domain/orders.errors";

/** The feature that must be enabled for orders to auto-couple with stock (D2). */
const INVENTORY_FEATURE = "inventory";

/** One row's outcome in a CSV import (atomic per row). */
export interface ImportResult {
  readonly row: number;
  readonly ok: boolean;
  readonly orderId?: string;
  readonly error?: { readonly code: string; readonly message: string };
}

/** A status transition request as it reaches the service (before feature-gating). */
export interface TransitionCommand {
  readonly toStatus: OrderStatus;
  readonly reasonId?: string | null;
  readonly note?: string | null;
}

/**
 * Orchestrates the orders module (EPIC-11). It enforces the tenant scope,
 * resolves whether stock coupling applies (the company's `inventory` feature,
 * decision D2), delegates persistence to the repository, and on every write
 * records a durable audit row and emits the matching `order.*` / `payment.*`
 * event. An idempotent replay writes nothing (no audit, no event). Access is
 * gated by the controller's `@RequireCapability`; this service assumes an
 * authorized caller.
 */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(ORDERS_REPOSITORY) private readonly repo: OrdersRepositoryPort,
    @Inject(ORDERS_AUDIT) private readonly audit: OrdersAuditPort,
    @Inject(EVENT_BUS) private readonly events: EventBusPort,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly access: AccessResolverService,
  ) {}

  async list(
    principal: RequestPrincipal,
    rawQuery: RawOrderListQuery,
  ): Promise<KeysetPage<OrderListView>> {
    const companyId = this.requireTenant(principal);
    const query = this.parseQuery(rawQuery);
    try {
      return await this.repo.list(companyId, query);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async statusCounts(
    principal: RequestPrincipal,
    rawQuery: RawOrderListQuery,
  ): Promise<Record<OrderStatus, number>> {
    const companyId = this.requireTenant(principal);
    const query = this.parseQuery(rawQuery);
    return this.repo.statusCounts(companyId, query);
  }

  async getOne(principal: RequestPrincipal, id: string): Promise<OrderView> {
    const companyId = this.requireTenant(principal);
    const order = await this.repo.findById(companyId, id);
    if (order === null) throw AppErrors.notFound("Order not found.");
    return order;
  }

  async create(
    principal: RequestPrincipal,
    data: CreateOrderInput,
  ): Promise<{ order: OrderView; replayed: boolean }> {
    const companyId = this.requireTenant(principal);
    const actor: WriteActor = { companyId, actorId: principal.userId };

    let result;
    try {
      result = await this.repo.create(actor, data);
    } catch (error) {
      throw this.mapError(error);
    }

    if (!result.replayed) {
      await this.audit.record({
        companyId,
        actorId: principal.userId,
        action: "order.created",
        entityType: "order",
        entityId: result.order.id,
        changes: { orderNumber: result.order.orderNumber, itemCount: result.order.items.length },
      });
      await this.events.publish({
        type: "order.created",
        companyId,
        actorId: principal.userId,
        occurredAt: this.clock.now(),
        payload: { orderId: result.order.id },
      });
    }
    return result;
  }

  async update(
    principal: RequestPrincipal,
    id: string,
    data: UpdateOrderInput,
  ): Promise<OrderView> {
    const companyId = this.requireTenant(principal);
    // Read the prior collected amount so we know whether money was collected.
    const before = await this.repo.findById(companyId, id);
    if (before === null) throw AppErrors.notFound("Order not found.");

    let order: OrderView | null;
    try {
      order = await this.repo.update({ companyId, actorId: principal.userId }, id, data);
    } catch (error) {
      throw this.mapError(error);
    }
    if (order === null) throw AppErrors.notFound("Order not found.");

    await this.audit.record({
      companyId,
      actorId: principal.userId,
      action: "order.updated",
      entityType: "order",
      entityId: order.id,
      changes: { fields: Object.keys(data).sort() },
    });

    const collectedDelta = order.collectedAmount - before.collectedAmount;
    if (collectedDelta > 0) {
      await this.audit.record({
        companyId,
        actorId: principal.userId,
        action: "order.payment_collected",
        entityType: "order",
        entityId: order.id,
        changes: { amountMinor: collectedDelta },
      });
      await this.events.publish({
        type: "payment.collected",
        companyId,
        actorId: principal.userId,
        occurredAt: this.clock.now(),
        payload: { orderId: order.id, amountMinor: collectedDelta },
      });
    }
    return order;
  }

  async transition(
    principal: RequestPrincipal,
    id: string,
    command: TransitionCommand,
  ): Promise<OrderView> {
    const companyId = this.requireTenant(principal);
    const input = await this.toTransitionInput(principal, command);

    let change: StatusChangeResult | null;
    try {
      change = await this.repo.transition({ companyId, actorId: principal.userId }, id, input);
    } catch (error) {
      throw this.mapError(error);
    }
    if (change === null) throw AppErrors.notFound("Order not found.");

    await this.recordTransition(principal, change);
    return change.order;
  }

  async assign(
    principal: RequestPrincipal,
    id: string,
    assigneeId: string | null,
  ): Promise<OrderView> {
    const companyId = this.requireTenant(principal);
    let order: OrderView | null;
    try {
      order = await this.repo.assign({ companyId, actorId: principal.userId }, id, assigneeId);
    } catch (error) {
      throw this.mapError(error);
    }
    if (order === null) throw AppErrors.notFound("Order not found.");
    await this.audit.record({
      companyId,
      actorId: principal.userId,
      action: "order.assigned",
      entityType: "order",
      entityId: order.id,
      changes: { assigneeId },
    });
    await this.events.publish({
      type: "order.assigned",
      companyId,
      actorId: principal.userId,
      occurredAt: this.clock.now(),
      payload: { orderId: order.id, assigneeId },
    });
    return order;
  }

  async bulkTransition(
    principal: RequestPrincipal,
    ids: readonly string[],
    command: TransitionCommand,
  ): Promise<readonly BulkItemResult[]> {
    const companyId = this.requireTenant(principal);
    const input = await this.toTransitionInput(principal, command);
    const { results, changes } = await this.repo.bulkTransition(
      { companyId, actorId: principal.userId },
      ids,
      input,
    );
    for (const change of changes) await this.recordTransition(principal, change);
    return results;
  }

  async bulkAssign(
    principal: RequestPrincipal,
    ids: readonly string[],
    assigneeId: string | null,
  ): Promise<readonly BulkItemResult[]> {
    const companyId = this.requireTenant(principal);
    const results = await this.repo.bulkAssign(
      { companyId, actorId: principal.userId },
      ids,
      assigneeId,
    );
    for (const result of results) {
      if (!result.ok) continue;
      await this.audit.record({
        companyId,
        actorId: principal.userId,
        action: "order.assigned",
        entityType: "order",
        entityId: result.orderId,
        changes: { assigneeId },
      });
      await this.events.publish({
        type: "order.assigned",
        companyId,
        actorId: principal.userId,
        occurredAt: this.clock.now(),
        payload: { orderId: result.orderId, assigneeId },
      });
    }
    return results;
  }

  /**
   * Deterministic smart-paste (ADR-0004): turn pasted text into draft fields. No
   * persistence, no AI — a pure transform behind an authenticated, gated route.
   */
  parse(principal: RequestPrincipal, text: string): ParsedDraft {
    this.requireTenant(principal);
    return parsePaste(text);
  }

  /**
   * Import orders from CSV with an explicit column mapping. Each mapped row
   * becomes one order (atomic per row); the response reports a per-row result, so
   * one bad row never fails the others. Capped at {@link IMPORT_MAX_ROWS}.
   */
  async importOrders(
    principal: RequestPrincipal,
    csv: string,
    mapping: ImportMapping,
  ): Promise<{ results: ImportResult[] }> {
    this.requireTenant(principal);
    const { rows, errors } = mapImport(parseCsv(csv), mapping);
    if (rows.length > IMPORT_MAX_ROWS) {
      throw AppErrors.badRequest(`Import exceeds the ${IMPORT_MAX_ROWS}-row limit.`);
    }

    const results: ImportResult[] = errors.map((e) => ({
      row: e.row,
      ok: false,
      error: { code: "UNPROCESSABLE_ENTITY", message: e.message },
    }));

    for (const row of rows) {
      try {
        const { order } = await this.create(principal, {
          customerId: row.customerId,
          items: [{ variantId: row.variantId, quantity: row.quantity, price: row.price }],
          shippingFee: row.shippingFee,
          discount: row.discount,
        });
        results.push({ row: row.row, ok: true, orderId: order.id });
      } catch (error) {
        results.push({ row: row.row, ok: false, error: this.toImportError(error) });
      }
    }
    results.sort((a, b) => a.row - b.row);
    return { results };
  }

  async listActivity(
    principal: RequestPrincipal,
    orderId: string,
    limit: string | undefined,
    cursor: string | undefined,
  ): Promise<KeysetPage<OrderActivityView>> {
    const companyId = this.requireTenant(principal);
    const page = await this.repo.listActivity(
      companyId,
      orderId,
      limit !== undefined ? Number(limit) : undefined,
      cursor,
    );
    if (page === null) throw AppErrors.notFound("Order not found.");
    return page;
  }

  // ---- internals -----------------------------------------------------------

  /** Record the durable audit row + emit `order.status_changed` for a transition. */
  private async recordTransition(
    principal: RequestPrincipal,
    change: StatusChangeResult,
  ): Promise<void> {
    await this.audit.record({
      companyId: principal.companyId as string,
      actorId: principal.userId,
      action: "order.status_changed",
      entityType: "order",
      entityId: change.order.id,
      changes: { from: change.fromStatus, to: change.toStatus },
    });
    await this.events.publish({
      type: "order.status_changed",
      companyId: principal.companyId as string,
      actorId: principal.userId,
      occurredAt: this.clock.now(),
      payload: {
        orderId: change.order.id,
        fromStatus: change.fromStatus,
        toStatus: change.toStatus,
      },
    });
  }

  /** Resolve `applyStock` from the company's `inventory` feature (decision D2). */
  private async toTransitionInput(
    principal: RequestPrincipal,
    command: TransitionCommand,
  ): Promise<TransitionInput> {
    const caps = await this.access.resolve(principal);
    return {
      toStatus: command.toStatus,
      ...(command.reasonId !== undefined ? { reasonId: command.reasonId } : {}),
      ...(command.note !== undefined ? { note: command.note } : {}),
      applyStock: caps.features.includes(INVENTORY_FEATURE),
    };
  }

  private parseQuery(rawQuery: RawOrderListQuery): ParsedOrderListQuery {
    const { query, errors } = parseOrderListQuery(rawQuery);
    if (query === undefined) throw AppErrors.validation("Request validation failed", errors);
    return query;
  }

  /** Render an import row failure into a stable code/message pair (no throw). */
  private toImportError(error: unknown): { code: string; message: string } {
    const mapped = this.mapError(error);
    if (mapped instanceof AppException) {
      const payload = mapped.getResponse() as { code?: string; message?: string };
      return {
        code: payload.code ?? "UNPROCESSABLE_ENTITY",
        message: payload.message ?? "The order could not be created.",
      };
    }
    return { code: "INTERNAL", message: "The order could not be created." };
  }

  private requireTenant(principal: RequestPrincipal): string {
    if (principal.companyId === null) {
      throw AppErrors.forbidden("Select an active company first.");
    }
    return principal.companyId;
  }

  private mapError(error: unknown): unknown {
    if (error instanceof DuplicateOrderError) {
      return AppErrors.conflict(error.message, [{ field: error.field, messages: [error.message] }]);
    }
    if (error instanceof InsufficientStockError) {
      return new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "UNPROCESSABLE_ENTITY",
        error.message,
        [{ field: error.field, messages: [error.message], shortages: error.shortages }],
      );
    }
    if (
      error instanceof ReferenceNotFoundError ||
      error instanceof IllegalTransitionError ||
      error instanceof ReasonRequiredError ||
      error instanceof EmptyOrderError ||
      error instanceof InvalidAmountError
    ) {
      const field = "field" in error && typeof error.field === "string" ? error.field : "status";
      return new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "UNPROCESSABLE_ENTITY",
        error.message,
        [{ field, messages: [error.message] }],
      );
    }
    if (error instanceof InvalidListCursorError) {
      return AppErrors.badRequest(error.message);
    }
    return error;
  }
}
