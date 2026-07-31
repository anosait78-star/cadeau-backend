import type { KeysetPage } from "@cadeau/database";
import type {
  BulkItemResult,
  OrderActivityView,
  OrderListView,
  OrderView,
  OrderWriteResult,
  StatusChangeResult,
} from "./order.entity";
import type { ParsedOrderListQuery } from "./list-query";
import type { FollowUpState, OrderStatus } from "./order-status";

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
}

/** Fields accepted when creating an order. */
export interface CreateOrderInput {
  readonly customerId: string;
  readonly assigneeId?: string | null;
  readonly labelId?: string | null;
  readonly reasonId?: string | null;
  readonly governorateId?: string | null;
  readonly followUpState?: FollowUpState;
  readonly shippingFee?: number;
  readonly discount?: number;
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
}

/** DI token for {@link OrdersRepositoryPort}. */
export const ORDERS_REPOSITORY = Symbol("ORDERS_REPOSITORY");
