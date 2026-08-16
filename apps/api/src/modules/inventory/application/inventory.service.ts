import { createHash, randomBytes } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppErrors, AppException } from "../../../shared/errors/app-exception";
import { withErrorMapping } from "../../../shared/errors/with-error-mapping";
import { EVENT_BUS, type EventBusPort } from "../../../shared/events/event-bus.port";
import { CLOCK, type Clock } from "../../../shared/time/clock";
import type { InventoryAuditPort, InventoryAuditRecord } from "../domain/inventory-audit.port";
import { INVENTORY_AUDIT } from "../domain/inventory-audit.port";
import {
  INVENTORY_REPOSITORY,
  type AdjustInput,
  type CreateWarehouseInput,
  type InventoryRepositoryPort,
  type ReserveInput,
  type SetReorderPointInput,
  type SetVariantWarehouseInput,
  type TransferInput,
  type UpdateWarehouseInput,
} from "../domain/inventory-repository.port";
import type {
  AdjustmentView,
  ReservationView,
  StockEffect,
  StockLevelView,
  StockWriteResult,
  TransferView,
  WarehouseJoinCodeCreatedView,
  WarehouseJoinCodeStatusView,
  WarehouseView,
} from "../domain/inventory.entity";
import {
  DuplicateWarehouseError,
  InsufficientStockError,
  InvalidListCursorError,
  ReferenceNotFoundError,
} from "../domain/inventory.errors";
import {
  parseStockListQuery,
  parseWarehouseListQuery,
  type RawStockListQuery,
  type RawWarehouseListQuery,
} from "../domain/list-query";

/**
 * Orchestrates the inventory module (EPIC-9). It enforces the tenant scope
 * (every operation requires an active company), delegates the atomic stock
 * writes to the repository, and — for each write that actually moved stock —
 * records a durable audit row and emits `stock.changed` per affected level plus
 * `stock.low` when that write crossed a reorder threshold. An idempotent replay
 * moves nothing, so it audits and emits nothing: the original request already
 * did. Access is gated by the controllers' `@RequireCapability`; this service
 * assumes an authorized caller.
 */
@Injectable()
export class InventoryService {
  constructor(
    @Inject(INVENTORY_REPOSITORY) private readonly repo: InventoryRepositoryPort,
    @Inject(INVENTORY_AUDIT) private readonly audit: InventoryAuditPort,
    @Inject(EVENT_BUS) private readonly events: EventBusPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ---- Warehouses ----------------------------------------------------------

  async listWarehouses(
    principal: RequestPrincipal,
    rawQuery: RawWarehouseListQuery,
  ): Promise<KeysetPage<WarehouseView>> {
    const companyId = this.requireTenant(principal);
    const { query, errors } = parseWarehouseListQuery(rawQuery);
    if (query === undefined) throw AppErrors.validation("Request validation failed", errors);

    const scope = await this.resolveWarehouseScope(principal, companyId);
    if (scope !== null) {
      // Vendor Accounts, Phase 1: a warehouse-scoped member sees only their own
      // warehouse, never the company's full set — server-side, regardless of
      // any filter in `rawQuery`.
      const row = await this.repo.findWarehouse(companyId, scope);
      const data = row === null ? [] : [row];
      return { data, page: { limit: 1, nextCursor: null, hasMore: false } };
    }
    return withErrorMapping(
      () => this.repo.listWarehouses(companyId, query),
      (error) => this.mapError(error),
    );
  }

  async getWarehouse(principal: RequestPrincipal, id: string): Promise<WarehouseView> {
    const companyId = this.requireTenant(principal);
    const scope = await this.resolveWarehouseScope(principal, companyId);
    // 404 (never leak existence) rather than 403: a warehouse-scoped member
    // must not learn that another warehouse id exists at all.
    if (scope !== null && scope !== id) throw AppErrors.notFound("Warehouse not found.");
    const row = await this.repo.findWarehouse(companyId, id);
    if (row === null) throw AppErrors.notFound("Warehouse not found.");
    return row;
  }

  async createWarehouse(
    principal: RequestPrincipal,
    data: CreateWarehouseInput,
  ): Promise<WarehouseView> {
    const companyId = this.requireTenant(principal);
    const row: WarehouseView = await withErrorMapping(
      () => this.repo.createWarehouse({ companyId, actorId: principal.userId }, data),
      (error) => this.mapError(error),
    );
    await this.record(companyId, principal.userId, {
      action: "inventory.warehouse_created",
      entityType: "warehouse",
      entityId: row.id,
      changes: row,
    });
    return row;
  }

  async updateWarehouse(
    principal: RequestPrincipal,
    id: string,
    data: UpdateWarehouseInput,
  ): Promise<WarehouseView> {
    const companyId = this.requireTenant(principal);
    const row: WarehouseView | null = await withErrorMapping(
      () => this.repo.updateWarehouse({ companyId, actorId: principal.userId }, id, data),
      (error) => this.mapError(error),
    );
    if (row === null) throw AppErrors.notFound("Warehouse not found.");
    await this.record(companyId, principal.userId, {
      action: "inventory.warehouse_updated",
      entityType: "warehouse",
      entityId: row.id,
      changes: row,
    });
    return row;
  }

  async archiveWarehouse(principal: RequestPrincipal, id: string): Promise<void> {
    const companyId = this.requireTenant(principal);
    const row = await this.repo.archiveWarehouse({ companyId, actorId: principal.userId }, id);
    if (row === null) throw AppErrors.notFound("Warehouse not found.");
    await this.record(companyId, principal.userId, {
      action: "inventory.warehouse_archived",
      entityType: "warehouse",
      entityId: row.id,
      changes: row,
    });
  }

  // ---- Warehouse join codes (Vendor Accounts, Phase 1) ----------------------

  /** Status only (exists/isActive/createdAt) — never the plaintext. */
  async getWarehouseJoinCode(
    principal: RequestPrincipal,
    warehouseId: string,
  ): Promise<WarehouseJoinCodeStatusView> {
    const companyId = this.requireTenant(principal);
    const status = await this.repo.getWarehouseJoinCodeStatus(companyId, warehouseId);
    if (status === null) throw AppErrors.notFound("Warehouse not found.");
    return status;
  }

  /**
   * Issue a fresh code for the warehouse, invalidating any previous one
   * (create-or-replace). Returns the plaintext once — the server stores only
   * its hash and can never redisplay it; a later "view" only shows status.
   */
  async rotateWarehouseJoinCode(
    principal: RequestPrincipal,
    warehouseId: string,
  ): Promise<WarehouseJoinCodeCreatedView> {
    const companyId = this.requireTenant(principal);
    const code = randomBytes(32).toString("base64url");
    const row = await this.repo.rotateWarehouseJoinCode(
      { companyId, actorId: principal.userId },
      warehouseId,
      hashJoinCode(code),
    );
    if (row === null) throw AppErrors.notFound("Warehouse not found.");
    await this.record(companyId, principal.userId, {
      action: "inventory.warehouse_join_code_rotated",
      entityType: "warehouse_join_code",
      entityId: warehouseId,
      // Never the code itself — only that a rotation happened and when.
      changes: { warehouseId, createdAt: row.createdAt },
    });
    return { code, createdAt: row.createdAt };
  }

  async revokeWarehouseJoinCode(principal: RequestPrincipal, warehouseId: string): Promise<void> {
    const companyId = this.requireTenant(principal);
    const revoked = await this.repo.revokeWarehouseJoinCode(
      { companyId, actorId: principal.userId },
      warehouseId,
    );
    if (!revoked) throw AppErrors.notFound("No join code exists for this warehouse.");
    await this.record(companyId, principal.userId, {
      action: "inventory.warehouse_join_code_revoked",
      entityType: "warehouse_join_code",
      entityId: warehouseId,
      changes: { warehouseId },
    });
  }

  // ---- Stock levels --------------------------------------------------------

  async listStock(
    principal: RequestPrincipal,
    rawQuery: RawStockListQuery,
  ): Promise<KeysetPage<StockLevelView>> {
    const companyId = this.requireTenant(principal);
    const { query, errors } = parseStockListQuery(rawQuery);
    if (query === undefined) throw AppErrors.validation("Request validation failed", errors);
    return withErrorMapping(
      () => this.repo.listStock(companyId, query),
      (error) => this.mapError(error),
    );
  }

  async setReorderPoint(
    principal: RequestPrincipal,
    data: SetReorderPointInput,
  ): Promise<StockLevelView> {
    const companyId = this.requireTenant(principal);
    const level: StockLevelView = await withErrorMapping(
      () => this.repo.setReorderPoint({ companyId, actorId: principal.userId }, data),
      (error) => this.mapError(error),
    );
    await this.record(companyId, principal.userId, {
      action: "inventory.reorder_point_set",
      entityType: "inventory_stock",
      entityId: level.id,
      changes: level,
    });
    return level;
  }

  async setVariantWarehouse(
    principal: RequestPrincipal,
    data: SetVariantWarehouseInput,
  ): Promise<StockLevelView> {
    const companyId = this.requireTenant(principal);
    const level: StockLevelView = await withErrorMapping(
      () => this.repo.setVariantWarehouse({ companyId, actorId: principal.userId }, data),
      (error) => this.mapError(error),
    );
    await this.record(companyId, principal.userId, {
      action: "inventory.variant_warehouse_set",
      entityType: "inventory_stock",
      entityId: level.id,
      changes: level,
    });
    return level;
  }

  // ---- Atomic stock writes -------------------------------------------------

  async reserve(principal: RequestPrincipal, data: ReserveInput): Promise<ReservationView> {
    const companyId = this.requireTenant(principal);
    const result: StockWriteResult<ReservationView> = await withErrorMapping(
      () => this.repo.reserve({ companyId, actorId: principal.userId }, data),
      (error) => this.mapError(error),
    );
    await this.settle(companyId, principal.userId, result, {
      action: "inventory.reserved",
      entityType: "stock_reservation",
    });
    return result.record;
  }

  async release(principal: RequestPrincipal, reservationId: string): Promise<ReservationView> {
    const companyId = this.requireTenant(principal);
    const result: StockWriteResult<ReservationView> | null = await withErrorMapping(
      () => this.repo.release({ companyId, actorId: principal.userId }, reservationId),
      (error) => this.mapError(error),
    );
    if (result === null) throw AppErrors.notFound("Reservation not found.");
    await this.settle(companyId, principal.userId, result, {
      action: "inventory.released",
      entityType: "stock_reservation",
    });
    return result.record;
  }

  async transfer(principal: RequestPrincipal, data: TransferInput): Promise<TransferView> {
    const companyId = this.requireTenant(principal);
    if (data.fromWarehouseId === data.toWarehouseId) {
      throw AppErrors.validation("Request validation failed", [
        { field: "toWarehouseId", messages: ["toWarehouseId must differ from fromWarehouseId"] },
      ]);
    }
    const result: StockWriteResult<TransferView> = await withErrorMapping(
      () => this.repo.transfer({ companyId, actorId: principal.userId }, data),
      (error) => this.mapError(error),
    );
    await this.settle(companyId, principal.userId, result, {
      action: "inventory.transferred",
      entityType: "stock_transfer",
    });
    return result.record;
  }

  async adjust(principal: RequestPrincipal, data: AdjustInput): Promise<AdjustmentView> {
    const companyId = this.requireTenant(principal);
    const result: StockWriteResult<AdjustmentView> = await withErrorMapping(
      () => this.repo.adjust({ companyId, actorId: principal.userId }, data),
      (error) => this.mapError(error),
    );
    await this.settle(companyId, principal.userId, result, {
      action: "inventory.adjusted",
      entityType: "stock_adjustment",
    });
    return result.record;
  }

  // ---- internals -----------------------------------------------------------

  /**
   * Audit + emit for a completed stock write. A replay is a no-op: the stock did
   * not move a second time, so neither the audit trail nor subscribers should
   * see it twice.
   */
  private async settle(
    companyId: string,
    actorId: string,
    result: StockWriteResult<{ readonly id: string }>,
    meta: {
      action: InventoryAuditRecord["action"];
      entityType: InventoryAuditRecord["entityType"];
    },
  ): Promise<void> {
    if (result.replayed) return;
    await this.record(companyId, actorId, {
      action: meta.action,
      entityType: meta.entityType,
      entityId: result.record.id,
      changes: { record: result.record, effects: result.effects },
    });
    for (const effect of result.effects) {
      await this.emitStockChanged(companyId, actorId, effect);
      if (effect.crossedLow) await this.emitStockLow(companyId, actorId, effect);
    }
  }

  private async emitStockChanged(
    companyId: string,
    actorId: string,
    effect: StockEffect,
  ): Promise<void> {
    await this.events.publish({
      type: "stock.changed",
      companyId,
      actorId,
      occurredAt: this.clock.now(),
      payload: {
        warehouseId: effect.warehouseId,
        variantId: effect.variantId,
        onHandDelta: effect.onHandDelta,
        committedDelta: effect.committedDelta,
        onHand: effect.level.onHand,
        committed: effect.level.committed,
        available: effect.level.available,
        reason: effect.reason,
      },
    });
  }

  private async emitStockLow(
    companyId: string,
    actorId: string,
    effect: StockEffect,
  ): Promise<void> {
    await this.events.publish({
      type: "stock.low",
      companyId,
      actorId,
      occurredAt: this.clock.now(),
      payload: {
        warehouseId: effect.warehouseId,
        variantId: effect.variantId,
        available: effect.level.available,
        reorderPoint: effect.level.reorderPoint,
      },
    });
  }

  private async record(
    companyId: string,
    actorId: string,
    entry: Omit<InventoryAuditRecord, "companyId" | "actorId">,
  ): Promise<void> {
    await this.audit.record({ companyId, actorId, ...entry });
  }

  private requireTenant(principal: RequestPrincipal): string {
    if (principal.companyId === null) {
      throw AppErrors.forbidden("Select an active company first.");
    }
    return principal.companyId;
  }

  /**
   * The warehouse the caller is scoped to (Vendor Accounts, Phase 1), or
   * `null` for an unscoped member who sees the whole company. Keys off
   * `CompanyMember.warehouseId` being set, not off `role === "vendor"`
   * literally — the same shape as `orders.service.ts`'s
   * `canSeeAllOrders`/`scopeToOwnOrders` for `orders.assign`.
   */
  private resolveWarehouseScope(
    principal: RequestPrincipal,
    companyId: string,
  ): Promise<string | null> {
    return this.repo.findMemberWarehouseScope(principal.userId, companyId);
  }

  private mapError(error: unknown): unknown {
    if (error instanceof DuplicateWarehouseError) {
      return AppErrors.conflict(error.message, [{ field: error.field, messages: [error.message] }]);
    }
    if (error instanceof ReferenceNotFoundError) {
      return new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "UNPROCESSABLE_ENTITY",
        error.message,
        [{ field: error.field, messages: [error.message] }],
      );
    }
    if (error instanceof InsufficientStockError) {
      return AppErrors.conflict(error.message, [{ field: error.field, messages: [error.message] }]);
    }
    if (error instanceof InvalidListCursorError) {
      return AppErrors.badRequest(error.message);
    }
    return error;
  }
}

/** SHA-256 hex hash of a warehouse join code — what we persist and look up by. */
function hashJoinCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
