import type {
  BulkShipmentResult,
  ShipmentStatusChangeResult,
  ShipmentView,
  ShipmentWriteResult,
} from "./shipment.entity";
import type { ShipmentStatus } from "./shipment-status";

/**
 * The tenant + acting member for a write. `actorId` is `null` for a
 * system-originated write — the M12.4 webhook processor applying a carrier
 * status change has no principal, only the event's own company (mirrors
 * `TenantActor` in `@cadeau/database`, "null for system/unauthenticated
 * actions").
 */
export interface WriteActor {
  readonly companyId: string;
  readonly actorId: string | null;
}

/** Fields accepted when creating a shipment. */
export interface CreateShipmentInput {
  readonly orderId: string;
  readonly idempotencyKey?: string | null;
  /** The client's carrier choice (the "select a carrier" step). Auto-detected when omitted. */
  readonly carrier?: string;
  /** Bosta-specific fields collected in the "select a carrier" step — see `CarrierCreateShipmentInput`. */
  readonly bostaCityId?: string;
  readonly bostaCityName?: string;
  readonly bostaDistrictId?: string;
  readonly notes?: string;
  readonly goodsValue?: number;
}

/** A status transition request. */
export interface TransitionInput {
  readonly toStatus: ShipmentStatus;
  readonly note?: string | null;
}

/**
 * Port for reading/writing shipments (EPIC-12). The Prisma adapter binds the
 * tenant under RLS for every unit of work, calls the {@link CarrierPort} to
 * book the dispatch, locks the order row while validating it is shippable
 * (docs/epic-12-design.md §1), and deducts the shipping fee from the order's
 * `collectedAmount` on delivery (decision D4) — all inside the same
 * transaction the status change commits in. Not-found reads/writes return
 * `null`.
 */
export interface ShippingRepositoryPort {
  findById(companyId: string, id: string): Promise<ShipmentView | null>;

  /** Looked up by the webhook processor (M12.4) to resolve a carrier callback to a shipment. */
  findByTrackingNumber(
    companyId: string,
    carrier: string,
    trackingNumber: string,
  ): Promise<ShipmentView | null>;

  /**
   * The most recent shipment for an order, or `null` if none exists yet
   * (M12.5 — lets the order detail show tracking without a general list
   * endpoint, which doesn't exist yet).
   */
  findLatestByOrderId(companyId: string, orderId: string): Promise<ShipmentView | null>;

  create(actor: WriteActor, data: CreateShipmentInput): Promise<ShipmentWriteResult>;

  /** Bulk-create; atomic per order, one result per requested order id. */
  bulkCreate(
    actor: WriteActor,
    orders: readonly CreateShipmentInput[],
  ): Promise<{ results: BulkShipmentResult[]; created: ShipmentWriteResult[] }>;

  /** Transition status, deducting the shipping fee from the order on delivery (D4). */
  transition(
    actor: WriteActor,
    id: string,
    data: TransitionInput,
  ): Promise<ShipmentStatusChangeResult | null>;

  /** Flip the metadata-only `waybillIssued` flag (decision D3 — no PDF body). */
  issueWaybill(actor: WriteActor, id: string): Promise<ShipmentView | null>;
}

/** DI token for {@link ShippingRepositoryPort}. */
export const SHIPPING_REPOSITORY = Symbol("SHIPPING_REPOSITORY");
