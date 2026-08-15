import type { KeysetPage } from "@cadeau/database";
import type {
  BulkItemResult,
  OrderActivityView,
  OrderListView,
  OrderVendorGroupView,
  OrderView,
  OrderWriteResult,
  StatusChangeResult,
} from "./order.entity";
import type { ParsedOrderListQuery } from "./list-query";
import type { FollowUpState, OrderStatus, PaymentStatus } from "./order-status";

/** The tenant + acting member for a write. */
export interface WriteActor {
  readonly companyId: string;
  readonly actorId: string;
}

/** One line to add to an order at create time. */
export interface CreateOrderItemInput {
  readonly variantId: string;
  readonly quantity: number;
  /** Unit sell price, integer minor units. */
  readonly price: number;
  /**
   * Per-line warehouse override (storefront multi-vendor routing). `null`/
   * omitted means "use the order's single `warehouseId`" — the behavior for
   * every manual/CSV/bulk order, unchanged. Set only by storefront ingestion
   * when the connection has vendor->warehouse mappings for this order.
   */
  readonly warehouseId?: string | null;
}

/** Fields accepted when creating an order. */
export interface CreateOrderInput {
  readonly customerId: string;
  readonly warehouseId?: string | null;
  readonly assigneeId?: string | null;
  readonly labelId?: string | null;
  readonly reasonId?: string | null;
  readonly governorateId?: string | null;
  readonly followUpState?: FollowUpState;
  readonly shippingFee?: number;
  readonly discount?: number;
  readonly collectedAmount?: number;
  readonly paymentStatus?: PaymentStatus;
  readonly notes?: string | null;
  readonly items: readonly CreateOrderItemInput[];
  readonly idempotencyKey?: string | null;
}

/** Partial header update; omitted keys are left unchanged. Items, when present, replace the set. */
export interface UpdateOrderInput {
  readonly assigneeId?: string | null;
  readonly labelId?: string | null;
  readonly reasonId?: string | null;
  readonly governorateId?: string | null;
  readonly followUpState?: FollowUpState;
  readonly shippingFee?: number;
  readonly discount?: number;
  readonly collectedAmount?: number;
  readonly notes?: string | null;
  readonly items?: readonly CreateOrderItemInput[];
}

/** A status transition request. */
export interface TransitionInput {
  readonly toStatus: OrderStatus;
  readonly reasonId?: string | null;
  readonly note?: string | null;
  /**
   * Whether the stock side effect should run (the app layer decides this from
   * the company's `inventory` feature flag — decision D2).
   */
  readonly applyStock: boolean;
}

/**
 * Port for reading/writing orders (EPIC-11). The Prisma adapter binds the tenant
 * under RLS for every unit of work, issues the per-company order number, freezes
 * the variant cost snapshot, runs the feature-gated stock side effects atomically
 * (reusing the EPIC-9 `FOR UPDATE` path), and recomputes the customer KPIs inside
 * the same transaction (decision D3). Not-found reads/writes return `null`.
 */
export interface OrdersRepositoryPort {
  list(companyId: string, query: ParsedOrderListQuery): Promise<KeysetPage<OrderListView>>;

  /** Live per-status counts for the status tabs (`{ new: 3, … }`). */
  statusCounts(
    companyId: string,
    query: ParsedOrderListQuery,
  ): Promise<Record<OrderStatus, number>>;

  findById(companyId: string, id: string): Promise<OrderView | null>;

  create(actor: WriteActor, data: CreateOrderInput): Promise<OrderWriteResult>;

  update(actor: WriteActor, id: string, data: UpdateOrderInput): Promise<OrderView | null>;

  /** Transition status, applying the stock side effect + KPI recompute. */
  transition(
    actor: WriteActor,
    id: string,
    data: TransitionInput,
  ): Promise<StatusChangeResult | null>;

  /** Assign (or unassign, `assigneeId: null`) an order. */
  assign(actor: WriteActor, id: string, assigneeId: string | null): Promise<OrderView | null>;

  /** Bulk transition; atomic per order, one result per requested id. */
  bulkTransition(
    actor: WriteActor,
    ids: readonly string[],
    data: TransitionInput,
  ): Promise<{ results: BulkItemResult[]; changes: StatusChangeResult[] }>;

  /** Bulk assign; atomic per order, one result per requested id. */
  bulkAssign(
    actor: WriteActor,
    ids: readonly string[],
    assigneeId: string | null,
  ): Promise<BulkItemResult[]>;

  /** A keyset page of an order's activity log, or `null` if the order is absent. */
  listActivity(
    companyId: string,
    orderId: string,
    limit: number | undefined,
    cursor: string | undefined,
  ): Promise<KeysetPage<OrderActivityView> | null>;

  /**
   * The order's vendor groups (Vendor Accounts, Phase 2): one per distinct
   * `warehouseId` among the order's items. Computed from the order's current
   * items and upserted idempotently — a repeat call for the same routing is a
   * no-op write. An order with no `warehouseId`-routed items (every order
   * today) returns an empty array. Assumes the order's existence/visibility
   * was already checked by the caller (same shape as `findById` + the
   * service's `assertVisible`); this method itself does not 404.
   */
  listVendorGroups(actor: WriteActor, orderId: string): Promise<OrderVendorGroupView[]>;

  // ---- Vendor Accounts, Phase 3 — vendor self-service surface --------------

  /**
   * The single warehouse an active `role = "vendor"` member is scoped to, or
   * `null` if the caller has no such membership in this tenant (not a vendor
   * at all, or not yet joined any warehouse).
   */
  findVendorWarehouseId(companyId: string, userId: string): Promise<string | null>;

  /**
   * Every vendor group at one warehouse, across every order, newest first —
   * the vendor's own "my orders" read. Does NOT materialize/create groups
   * (only the Parent Order's `processing` transition and the company-side
   * `listVendorGroups` do that) — a warehouse with no activated groups yet
   * simply returns an empty array.
   */
  listVendorGroupsForWarehouse(
    companyId: string,
    warehouseId: string,
  ): Promise<OrderVendorGroupView[]>;

  /**
   * One vendor group's ownership-relevant fields, or `null` if unknown in
   * this tenant. Used to check `warehouseId` ownership and the current
   * `status` before attempting a transition.
   */
  findVendorGroupById(
    companyId: string,
    groupId: string,
  ): Promise<{
    readonly id: string;
    readonly orderId: string;
    readonly warehouseId: string;
    readonly status: string;
  } | null>;

  /**
   * Advance one vendor group's status, guarded by its expected current status
   * (`fromStatus`) so a concurrent double-submit can't apply twice. Returns
   * the updated view, or `null` if the group is gone or was no longer at
   * `fromStatus` (someone else changed it first) — the caller decides how to
   * surface that.
   */
  updateVendorGroupStatus(
    actor: WriteActor,
    groupId: string,
    fromStatus: string,
    toStatus: string,
  ): Promise<OrderVendorGroupView | null>;
}

/** DI token for {@link OrdersRepositoryPort}. */
export const ORDERS_REPOSITORY = Symbol("ORDERS_REPOSITORY");
