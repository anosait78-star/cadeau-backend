import { apiFetch } from "@/lib/api-client";
import type { VendorGroupStatus } from "@/features/vendor/vendor-api";

/**
 * Client for `/v1/orders` (contract: docs/api/orders.md). Money is always integer
 * minor units. A list row is an {@link OrderListItem} (no items); the items and
 * notes arrive with the {@link OrderDetail} single-order read.
 */

/** The 12 lifecycle states, in lifecycle order (docs/epic-11-design.md §6). */
export const ORDER_STATUSES = [
  "new",
  "confirming",
  "processing",
  "incomplete",
  "ready",
  "shipped",
  "delivered",
  "completed",
  "postponed",
  "cancelled",
  "returned",
  "exchanged",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const FOLLOW_UP_STATES = ["none", "pending", "contacted", "scheduled", "no_answer"] as const;
export type FollowUpState = (typeof FOLLOW_UP_STATES)[number];

export type PaymentStatus = "unpaid" | "partial" | "paid";

/** The money block, all integer minor units. */
export interface OrderMoney {
  readonly subtotal: number;
  readonly shippingFee: number;
  readonly discount: number;
  readonly total: number;
  readonly collectedAmount: number;
  readonly paymentStatus: PaymentStatus;
}

/** An order line. */
export interface OrderItem {
  readonly id: string;
  readonly variantId: string;
  readonly nameSnapshot: string;
  readonly quantity: number;
  readonly price: number;
  readonly costSnapshot: number;
}

/** An order as a list row (no items). */
export interface OrderListItem extends OrderMoney {
  readonly id: string;
  readonly orderNumber: number;
  readonly customerId: string;
  readonly customerName: string;
  readonly assigneeId: string | null;
  readonly status: OrderStatus;
  readonly followUpState: FollowUpState;
  readonly labelId: string | null;
  readonly reasonId: string | null;
  readonly governorateId: string | null;
  readonly warehouseId: string | null;
  readonly itemCount: number;
  readonly statusChangedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A single order read: the header plus its items and notes. */
export interface OrderDetail extends OrderListItem {
  readonly notes: string | null;
  readonly items: OrderItem[];
}

/** One row of the activity log. */
export interface OrderActivity {
  readonly id: string;
  readonly kind: string;
  readonly fromValue: string | null;
  readonly toValue: string | null;
  readonly note: string | null;
  readonly actorId: string | null;
  readonly createdAt: string;
}

interface Page<T> {
  readonly data: T[];
  readonly page: {
    readonly limit: number;
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

export type OrderPage = Page<OrderListItem>;
export type OrderActivityPage = Page<OrderActivity>;

/** Query options for the orders list. */
export interface ListOptions {
  readonly cursor?: string;
  readonly q?: string;
  readonly status?: OrderStatus;
  readonly followUpState?: FollowUpState;
  readonly assigneeId?: string;
  readonly customerId?: string;
  readonly labelId?: string;
  readonly reasonId?: string;
  readonly governorateId?: string;
  readonly createdAtFrom?: string;
  readonly createdAtTo?: string;
  readonly sort?: "-createdAt" | "-updatedAt";
}

function buildQuery(options: ListOptions): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && String(value).length > 0) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : "";
}

/** A line to send when creating/updating an order. */
export interface OrderItemInput {
  readonly variantId: string;
  readonly quantity: number;
  readonly price: number;
}

/** Create-order body. */
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
  readonly paymentStatus?: PaymentStatus;
  readonly collectedAmount?: number;
  readonly notes?: string | null;
  readonly items: OrderItemInput[];
}

/** Update-order body (partial). Items, when present, replace the set. */
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
  readonly items?: OrderItemInput[];
}

/** One item's outcome in a bulk operation. */
export interface BulkResultItem {
  readonly orderId: string;
  readonly ok: boolean;
  readonly error?: { readonly code: string; readonly message: string };
}

/** `GET /v1/orders` — keyset-paginated orders. */
export function listOrders(options: ListOptions = {}): Promise<OrderPage> {
  return apiFetch<OrderPage>(`/orders${buildQuery(options)}`);
}

/** `GET /v1/orders/status-counts` — per-status counts for the tabs. */
export function orderStatusCounts(
  options: ListOptions = {},
): Promise<{ counts: Record<string, number> }> {
  return apiFetch<{ counts: Record<string, number> }>(
    `/orders/status-counts${buildQuery(options)}`,
  );
}

/** `GET /v1/orders/{id}` — order detail (items + money). */
export function getOrder(id: string): Promise<OrderDetail> {
  return apiFetch<OrderDetail>(`/orders/${id}`);
}

/** `POST /v1/orders` — create an order. */
export function createOrder(body: CreateOrderInput): Promise<OrderDetail> {
  return apiFetch<OrderDetail>("/orders", { method: "POST", body });
}

/** `PATCH /v1/orders/{id}` — edit order fields. */
export function updateOrder(id: string, body: UpdateOrderInput): Promise<OrderDetail> {
  return apiFetch<OrderDetail>(`/orders/${id}`, { method: "PATCH", body });
}

/** `POST /v1/orders/{id}/status` — transition status. */
export function transitionOrder(
  id: string,
  body: { toStatus: OrderStatus; reasonId?: string | null; note?: string | null },
): Promise<OrderDetail> {
  return apiFetch<OrderDetail>(`/orders/${id}/status`, { method: "POST", body });
}

/** `POST /v1/orders/{id}/assign` — assign (or unassign) an order. */
export function assignOrder(id: string, assigneeId: string | null): Promise<OrderDetail> {
  return apiFetch<OrderDetail>(`/orders/${id}/assign`, { method: "POST", body: { assigneeId } });
}

/** `POST /v1/orders/bulk/status` — bulk status change. */
export function bulkStatus(
  orderIds: string[],
  toStatus: OrderStatus,
  reasonId?: string | null,
): Promise<{ results: BulkResultItem[] }> {
  return apiFetch<{ results: BulkResultItem[] }>("/orders/bulk/status", {
    method: "POST",
    body: { orderIds, toStatus, ...(reasonId !== undefined ? { reasonId } : {}) },
  });
}

/** `POST /v1/orders/bulk/assign` — bulk assignment. */
export function bulkAssign(
  orderIds: string[],
  assigneeId: string | null,
): Promise<{ results: BulkResultItem[] }> {
  return apiFetch<{ results: BulkResultItem[] }>("/orders/bulk/assign", {
    method: "POST",
    body: { orderIds, assigneeId },
  });
}

/** `GET /v1/orders/{id}/activity` — the order's activity log (keyset). */
export function listOrderActivity(id: string, cursor?: string): Promise<OrderActivityPage> {
  const qs = cursor !== undefined ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<OrderActivityPage>(`/orders/${id}/activity${qs}`);
}

/** One item within a vendor group (Vendor Accounts, Phase 2/3) — no cost snapshot. */
export interface OrderVendorGroupItem {
  readonly id: string;
  readonly variantId: string;
  readonly nameSnapshot: string;
  readonly quantity: number;
  readonly price: number;
}

/**
 * A vendor's slice of this order — the items routed to one warehouse, plus
 * that warehouse's own tracking status (`new`/`processing`/`ready`/`delivered`).
 */
export interface OrderVendorGroup {
  readonly id: string;
  readonly orderId: string;
  readonly orderNumber: number;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly warehouseCode: string | null;
  readonly vendorMemberId: string | null;
  /** The vendor's name/email, or null if no vendor has joined this warehouse yet. */
  readonly vendorName: string | null;
  readonly status: string;
  /** When `status` (or the group) last changed. */
  readonly updatedAt: string;
  readonly items: readonly OrderVendorGroupItem[];
}

/**
 * `GET /v1/orders/{id}/vendor-groups` — the order's items grouped by
 * warehouse (Vendor Accounts, Phase 2/3). Empty for every order that isn't
 * multi-vendor-routed (every order before this feature, and every manual/
 * CSV/bulk order since).
 *
 * `aggregateStatus` (Phase 8) is the LEAST advanced status among all groups
 * — the order isn't really done until every vendor is — computed fresh on
 * every read, never persisted, never affecting `Order.status` itself. `null`
 * when `data` is empty.
 */
export function listOrderVendorGroups(
  id: string,
): Promise<{ data: OrderVendorGroup[]; aggregateStatus: VendorGroupStatus | null }> {
  return apiFetch(`/orders/${id}/vendor-groups`);
}

/** A parsed order line from smart-paste. */
export interface ParsedItem {
  readonly name: string;
  readonly quantity: number;
}

/** The structured draft a paste resolves to (deterministic, no AI). */
export interface ParsedDraft {
  readonly name: string | null;
  readonly phone: string | null;
  readonly address: string | null;
  readonly items: ParsedItem[];
  readonly notes: string | null;
}

/** `POST /v1/orders/parse` — deterministic smart-paste → draft fields (no AI). */
export function parseOrder(text: string): Promise<ParsedDraft> {
  return apiFetch<ParsedDraft>("/orders/parse", { method: "POST", body: { text } });
}

/** The column mapping for a CSV import (values are header column names). */
export interface ImportMapping {
  readonly customerId: string;
  readonly variantId: string;
  readonly quantity: string;
  readonly price: string;
  readonly shippingFee?: string;
  readonly discount?: string;
}

/** One row's outcome in a CSV import. */
export interface ImportResultItem {
  readonly row: number;
  readonly ok: boolean;
  readonly orderId?: string;
  readonly error?: { readonly code: string; readonly message: string };
}

/** `POST /v1/orders/import` — import orders from CSV with a column mapping. */
export function importOrders(
  csv: string,
  mapping: ImportMapping,
): Promise<{ results: ImportResultItem[] }> {
  return apiFetch<{ results: ImportResultItem[] }>("/orders/import", {
    method: "POST",
    body: { csv, mapping },
  });
}
