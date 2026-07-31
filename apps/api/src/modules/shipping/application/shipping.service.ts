import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppErrors, AppException } from "../../../shared/errors/app-exception";
import { EVENT_BUS, type EventBusPort } from "../../../shared/events/event-bus.port";
import { CLOCK, type Clock } from "../../../shared/time/clock";
import { CARRIER_PORT, type CarrierPort } from "../domain/carrier.port";
import type {
  BulkShipmentResult,
  ShipmentStatusChangeResult,
  ShipmentView,
} from "../domain/shipment.entity";
import type { ShipmentStatus } from "../domain/shipment-status";
import { SHIPPING_AUDIT, type ShippingAuditPort } from "../domain/shipping-audit.port";
import {
  SHIPPING_REPOSITORY,
  type CreateShipmentInput,
  type ShippingRepositoryPort,
  type WriteActor,
} from "../domain/shipping-repository.port";
import {
  DuplicateActiveShipmentError,
  DuplicateShipmentError,
  IllegalTransitionError,
  InvalidAmountError,
  OrderNotShippableError,
  ReferenceNotFoundError,
} from "../domain/shipping.errors";

/** A status transition request as it reaches the service. */
export interface TransitionCommand {
  readonly toStatus: ShipmentStatus;
  readonly note?: string | null;
}

/**
 * Orchestrates the shipping module (EPIC-12). Delegates persistence (carrier
 * dispatch, order validation, fee deduction) to the repository, and on every
 * write records a durable audit row and emits the matching `shipment.*` event.
 * An idempotent replay writes nothing (no audit, no event) — the same contract
 * orders/customers use. Access is gated by the controller's
 * `@RequireCapability` (M12.3); this service assumes an authorized caller.
 */
@Injectable()
export class ShippingService {
  constructor(
    @Inject(SHIPPING_REPOSITORY) private readonly repo: ShippingRepositoryPort,
    @Inject(SHIPPING_AUDIT) private readonly audit: ShippingAuditPort,
    @Inject(EVENT_BUS) private readonly events: EventBusPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CARRIER_PORT) private readonly carrier: CarrierPort,
  ) {}

  /** The carriers available behind the abstraction (today: `manual` only, D1). */
  listCarriers(principal: RequestPrincipal): readonly { key: string }[] {
    this.requireTenant(principal);
    return [{ key: this.carrier.name }];
  }

  async getOne(principal: RequestPrincipal, id: string): Promise<ShipmentView> {
    const companyId = this.requireTenant(principal);
    const shipment = await this.repo.findById(companyId, id);
    if (shipment === null) throw AppErrors.notFound("Shipment not found.");
    return shipment;
  }

  async create(
    principal: RequestPrincipal,
    data: CreateShipmentInput,
  ): Promise<{ shipment: ShipmentView; replayed: boolean }> {
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
        action: "shipment.created",
        entityType: "shipment",
        entityId: result.shipment.id,
        changes: { orderId: result.shipment.orderId, carrier: result.shipment.carrier },
      });
      await this.events.publish({
        type: "shipment.created",
        companyId,
        actorId: principal.userId,
        occurredAt: this.clock.now(),
        payload: {
          shipmentId: result.shipment.id,
          orderId: result.shipment.orderId,
          carrier: result.shipment.carrier,
        },
      });
    }
    return result;
  }

  async bulkCreate(
    principal: RequestPrincipal,
    orders: readonly CreateShipmentInput[],
  ): Promise<readonly BulkShipmentResult[]> {
    const companyId = this.requireTenant(principal);
    const { results, created } = await this.repo.bulkCreate(
      { companyId, actorId: principal.userId },
      orders,
    );
    for (const result of created) {
      if (result.replayed) continue;
      await this.audit.record({
        companyId,
        actorId: principal.userId,
        action: "shipment.created",
        entityType: "shipment",
        entityId: result.shipment.id,
        changes: { orderId: result.shipment.orderId, carrier: result.shipment.carrier },
      });
      await this.events.publish({
        type: "shipment.created",
        companyId,
        actorId: principal.userId,
        occurredAt: this.clock.now(),
        payload: {
          shipmentId: result.shipment.id,
          orderId: result.shipment.orderId,
          carrier: result.shipment.carrier,
        },
      });
    }
    return results;
  }

  async transition(
    principal: RequestPrincipal,
    id: string,
    command: TransitionCommand,
  ): Promise<ShipmentView> {
    const companyId = this.requireTenant(principal);
    let change: ShipmentStatusChangeResult | null;
    try {
      change = await this.repo.transition({ companyId, actorId: principal.userId }, id, {
        toStatus: command.toStatus,
        ...(command.note !== undefined ? { note: command.note } : {}),
      });
    } catch (error) {
      throw this.mapError(error);
    }
    if (change === null) throw AppErrors.notFound("Shipment not found.");

    await this.recordTransition(principal, change);
    return change.shipment;
  }

  /** Cancel a shipment: a transition to `cancelled`, calling the carrier to cancel it. */
  async cancel(
    principal: RequestPrincipal,
    id: string,
    note?: string | null,
  ): Promise<ShipmentView> {
    return this.transition(principal, id, {
      toStatus: "cancelled",
      ...(note !== undefined ? { note } : {}),
    });
  }

  /**
   * Issue the waybill: flips the metadata-only `waybillIssued` flag and asks
   * the carrier for the label metadata (decision D3 — no PDF body in this
   * epic; rendering reuses EPIC-13's shared PDF work).
   */
  async generateWaybill(
    principal: RequestPrincipal,
    id: string,
  ): Promise<{ shipment: ShipmentView; trackingNumber: string; carrier: string }> {
    const companyId = this.requireTenant(principal);
    const shipment = await this.repo.issueWaybill({ companyId, actorId: principal.userId }, id);
    if (shipment === null) throw AppErrors.notFound("Shipment not found.");

    const waybill = await this.carrier.generateWaybill(shipment.trackingNumber);
    await this.audit.record({
      companyId,
      actorId: principal.userId,
      action: "shipment.waybill_issued",
      entityType: "shipment",
      entityId: shipment.id,
      changes: { carrier: waybill.carrier },
    });
    return { shipment, trackingNumber: waybill.trackingNumber, carrier: waybill.carrier };
  }

  // ---- internals -------------------------------------------------------------

  /**
   * Record the durable audit row + emit `shipment.status_changed` (or
   * `shipment.cancelled`) for a transition, plus `shipment.delivered` when the
   * transition deducted a shipping fee (decision D4).
   */
  private async recordTransition(
    principal: RequestPrincipal,
    change: ShipmentStatusChangeResult,
  ): Promise<void> {
    const companyId = principal.companyId as string;
    await this.audit.record({
      companyId,
      actorId: principal.userId,
      action: change.toStatus === "cancelled" ? "shipment.cancelled" : "shipment.status_changed",
      entityType: "shipment",
      entityId: change.shipment.id,
      changes: { from: change.fromStatus, to: change.toStatus },
    });
    await this.events.publish({
      type: "shipment.status_changed",
      companyId,
      actorId: principal.userId,
      occurredAt: this.clock.now(),
      payload: {
        shipmentId: change.shipment.id,
        orderId: change.shipment.orderId,
        fromStatus: change.fromStatus,
        toStatus: change.toStatus,
      },
    });
    if (change.feeDeducted > 0) {
      await this.events.publish({
        type: "shipment.delivered",
        companyId,
        actorId: principal.userId,
        occurredAt: this.clock.now(),
        payload: {
          shipmentId: change.shipment.id,
          orderId: change.shipment.orderId,
          feeMinor: change.feeDeducted,
        },
      });
    }
  }

  private requireTenant(principal: RequestPrincipal): string {
    if (principal.companyId === null) {
      throw AppErrors.forbidden("Select an active company first.");
    }
    return principal.companyId;
  }

  private mapError(error: unknown): unknown {
    if (error instanceof DuplicateShipmentError) {
      return AppErrors.conflict(error.message, [{ field: error.field, messages: [error.message] }]);
    }
    if (error instanceof DuplicateActiveShipmentError) {
      return AppErrors.conflict(error.message);
    }
    if (
      error instanceof ReferenceNotFoundError ||
      error instanceof IllegalTransitionError ||
      error instanceof OrderNotShippableError ||
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
    return error;
  }
}
