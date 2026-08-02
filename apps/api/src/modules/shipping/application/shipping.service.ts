import { randomBytes, createHash } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { encrypt } from "@cadeau/crypto";
import { APP_CONFIG, type InjectedAppConfig } from "../../../shared/config/config.tokens";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppErrors, AppException } from "../../../shared/errors/app-exception";
import { EVENT_BUS, type EventBusPort } from "../../../shared/events/event-bus.port";
import { CLOCK, type Clock } from "../../../shared/time/clock";
import type { CarrierConnectionView } from "../domain/carrier-connection.entity";
import {
  CARRIER_CONNECTIONS_REPOSITORY,
  type CarrierConnectionsRepositoryPort,
} from "../domain/carrier-connections-repository.port";
import { CARRIER_PORT, type CarrierPort } from "../domain/carrier.port";
import type { BostaCityView, BostaDistrictView } from "../domain/bosta-catalog.entity";
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
  CarrierAuthError,
  CarrierNotConnectedError,
  CarrierUnavailableError,
  CodLimitExceededError,
  CustomerAddressMissingError,
  CustomerAddressNotMappedError,
  DuplicateActiveShipmentError,
  DuplicateShipmentError,
  IllegalTransitionError,
  OrderNotShippableError,
  ReferenceNotFoundError,
} from "../domain/shipping.errors";
import {
  BOSTA_CATALOG_CACHE,
  type BostaCatalogCachePort,
} from "../domain/bosta-catalog-cache.port";
import { BOSTA_HTTP_CLIENT, type BostaHttpClientPort } from "../domain/bosta-http-client.port";

/** The carrier keys this deployment knows about, in display order. */
const KNOWN_CARRIERS = ["manual", "bosta"] as const;

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
    @Inject(CARRIER_CONNECTIONS_REPOSITORY)
    private readonly connections: CarrierConnectionsRepositoryPort,
    @Inject(APP_CONFIG) private readonly config: InjectedAppConfig,
    @Inject(BOSTA_CATALOG_CACHE) private readonly bostaCatalog: BostaCatalogCachePort,
    @Inject(BOSTA_HTTP_CLIENT) private readonly bostaHttpClient: BostaHttpClientPort,
  ) {}

  /**
   * The carriers this deployment knows about, with each tenant's connection
   * state. `manual` needs no connection (it's always available); `bosta`
   * reflects the caller's `carrier_connections` row, if any.
   */
  async listCarriers(principal: RequestPrincipal): Promise<CarrierConnectionView[]> {
    const companyId = this.requireTenant(principal);
    const rows = await this.connections.list(companyId);
    return KNOWN_CARRIERS.map((key) => {
      if (key === "manual") {
        return {
          id: null,
          carrier: "manual",
          connected: true,
          pickupLocationWarning: false,
          connectedAt: null,
        };
      }
      const row = rows.find((r) => r.carrier === key);
      return (
        row ?? {
          id: null,
          carrier: key,
          connected: false,
          pickupLocationWarning: false,
          connectedAt: null,
        }
      );
    });
  }

  /**
   * Connect the caller's active company to a real carrier. Validates the key
   * against the carrier before persisting anything (no half-connected state)
   * by probing an authenticated read; the key is then encrypted at rest and
   * never returned. A random webhook token is minted and only its hash is
   * stored (mirrors `Invitation.codeHash`) — the raw token is embedded in the
   * `webhookUrl` the carrier adapter registers on each shipment, never shown
   * to the caller.
   */
  async connectCarrier(
    principal: RequestPrincipal,
    carrier: string,
    apiKey: string,
  ): Promise<CarrierConnectionView> {
    const companyId = this.requireTenant(principal);
    if (carrier !== "bosta") {
      throw AppErrors.badRequest(`Unknown or unsupported carrier '${carrier}'.`);
    }

    let pickupLocationWarning: boolean;
    try {
      pickupLocationWarning = await this.probeBosta(apiKey);
    } catch (error) {
      throw this.mapError(error);
    }

    const webhookToken = randomBytes(32).toString("base64url");
    const webhookTokenHash = createHash("sha256").update(webhookToken).digest("hex");
    const apiKeyEncrypted = encrypt(apiKey, this.config.encryption.key);

    const view = await this.connections.upsert({
      companyId,
      carrier,
      apiKeyEncrypted,
      webhookTokenHash,
      pickupLocationWarning,
      actorId: principal.userId,
    });

    // upsert() always creates/updates a row, so it always returns an id.
    await this.audit.record({
      companyId,
      actorId: principal.userId,
      action: "carrier.connected",
      entityType: "carrier_connection",
      entityId: view.id as string,
    });
    return view;
  }

  async disconnectCarrier(principal: RequestPrincipal, carrier: string): Promise<void> {
    const companyId = this.requireTenant(principal);
    const removedId = await this.connections.deactivate(companyId, carrier, principal.userId);
    if (removedId === null) throw AppErrors.notFound("No active connection for that carrier.");
    await this.audit.record({
      companyId,
      actorId: principal.userId,
      action: "carrier.disconnected",
      entityType: "carrier_connection",
      entityId: removedId,
    });
  }

  /**
   * Bosta's city catalog (public, unauthenticated — Phase C's address
   * picker). Cached for a few hours; requires no carrier connection since
   * the endpoint needs no API key.
   */
  async listBostaCities(principal: RequestPrincipal): Promise<BostaCityView[]> {
    this.requireTenant(principal);
    const cached = this.bostaCatalog.get<BostaCityView[]>("cities");
    if (cached !== null) return cached;

    let response: { data?: { list?: { _id: string; name: string; nameAr?: string }[] } };
    try {
      response = await this.bostaHttpClient.request("GET", "cities");
    } catch (error) {
      throw this.mapError(error);
    }
    const cities = (response.data?.list ?? []).map((c) => ({
      id: c._id,
      name: c.name,
      nameAr: c.nameAr ?? null,
    }));
    this.bostaCatalog.set("cities", cities);
    return cities;
  }

  /** Bosta's districts for one city (public, unauthenticated). Cached per city. */
  async listBostaDistricts(
    principal: RequestPrincipal,
    cityId: string,
  ): Promise<BostaDistrictView[]> {
    this.requireTenant(principal);
    const cacheKey = `districts:${cityId}`;
    const cached = this.bostaCatalog.get<BostaDistrictView[]>(cacheKey);
    if (cached !== null) return cached;

    let response: {
      data?: readonly {
        districtId: string;
        districtName: string;
        zoneId: string;
        zoneName: string;
      }[];
    };
    try {
      response = await this.bostaHttpClient.request(
        "GET",
        `cities/${encodeURIComponent(cityId)}/districts`,
      );
    } catch (error) {
      throw this.mapError(error);
    }
    const districts = (response.data ?? []).map((d) => ({
      districtId: d.districtId,
      districtName: d.districtName,
      zoneId: d.zoneId,
      zoneName: d.zoneName,
    }));
    this.bostaCatalog.set(cacheKey, districts);
    return districts;
  }

  /** `GET /pickup-locations` — proves the key works; an empty list is a warning, not a failure. */
  private async probeBosta(apiKey: string): Promise<boolean> {
    const response = await this.bostaHttpClient.request<{ data?: { list?: unknown[] } }>(
      "GET",
      "pickup-locations",
      apiKey,
    );
    const list = response.data?.list ?? [];
    return list.length === 0;
  }

  async getOne(principal: RequestPrincipal, id: string): Promise<ShipmentView> {
    const companyId = this.requireTenant(principal);
    const shipment = await this.repo.findById(companyId, id);
    if (shipment === null) throw AppErrors.notFound("Shipment not found.");
    return shipment;
  }

  /** Looked up by the webhook processor (M12.4) to resolve a carrier callback. */
  findShipmentByTracking(
    companyId: string,
    carrier: string,
    trackingNumber: string,
  ): Promise<ShipmentView | null> {
    return this.repo.findByTrackingNumber(companyId, carrier, trackingNumber);
  }

  /**
   * The most recent shipment for an order (M12.5 — the order detail's
   * tracking section; no general list endpoint exists yet).
   */
  async getByOrder(principal: RequestPrincipal, orderId: string): Promise<ShipmentView> {
    const companyId = this.requireTenant(principal);
    const shipment = await this.repo.findLatestByOrderId(companyId, orderId);
    if (shipment === null) throw AppErrors.notFound("No shipment for this order.");
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
   * Apply a status transition on behalf of a system process (EPIC-12 M12.4's
   * webhook processor) — no principal, `actorId: null`. Raw domain errors
   * (`IllegalTransitionError`, `ReferenceNotFoundError`, …) propagate
   * **unwrapped** — no HTTP mapping — so the caller can apply its own
   * retry/backoff policy instead of reading an HTTP status.
   */
  async applySystemTransition(
    companyId: string,
    id: string,
    command: TransitionCommand,
  ): Promise<ShipmentView> {
    const change = await this.repo.transition({ companyId, actorId: null }, id, {
      toStatus: command.toStatus,
      ...(command.note !== undefined ? { note: command.note } : {}),
    });
    if (change === null) throw new ReferenceNotFoundError("shipmentId");
    await this.recordTransitionCore(companyId, null, change);
    return change.shipment;
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

    const waybill = await this.carrier.generateWaybill(companyId, shipment.trackingNumber);
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

  /** Record the durable audit row + emit the transition events for a principal-driven change. */
  private async recordTransition(
    principal: RequestPrincipal,
    change: ShipmentStatusChangeResult,
  ): Promise<void> {
    await this.recordTransitionCore(principal.companyId as string, principal.userId, change);
  }

  /**
   * Record the durable audit row + emit `shipment.status_changed` (or
   * `shipment.cancelled`) for a transition, plus `shipment.delivered` when the
   * transition deducted a shipping fee (decision D4). `actorId` is `null` for
   * a system-originated change (M12.4's webhook processor).
   */
  private async recordTransitionCore(
    companyId: string,
    actorId: string | null,
    change: ShipmentStatusChangeResult,
  ): Promise<void> {
    await this.audit.record({
      companyId,
      actorId,
      action: change.toStatus === "cancelled" ? "shipment.cancelled" : "shipment.status_changed",
      entityType: "shipment",
      entityId: change.shipment.id,
      changes: { from: change.fromStatus, to: change.toStatus },
    });
    await this.events.publish({
      type: "shipment.status_changed",
      companyId,
      actorId,
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
        actorId,
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
      error instanceof OrderNotShippableError
    ) {
      const field = "field" in error && typeof error.field === "string" ? error.field : "status";
      return new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "UNPROCESSABLE_ENTITY",
        error.message,
        [{ field, messages: [error.message] }],
      );
    }
    if (error instanceof CarrierAuthError) {
      return AppErrors.unprocessable(
        `${error.carrier} rejected the API key — reconnect it in settings.`,
      );
    }
    if (
      error instanceof CarrierNotConnectedError ||
      error instanceof CustomerAddressMissingError ||
      error instanceof CustomerAddressNotMappedError ||
      error instanceof CodLimitExceededError
    ) {
      return AppErrors.unprocessable(error.message);
    }
    if (error instanceof CarrierUnavailableError) {
      return AppErrors.serviceUnavailable(error.message);
    }
    return error;
  }
}
