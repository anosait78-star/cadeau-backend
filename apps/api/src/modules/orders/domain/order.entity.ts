/**
 * Order domain views (EPIC-11): the shapes the application layer returns and the
 * presentation layer renders, decoupled from the Prisma rows. Money is always
 * integer minor units (api-conventions §money).
 */

import type { FollowUpState, OrderStatus, PaymentStatus } from "./order-status";

/** One line on an order: a variant, a quantity, a unit price, a frozen cost. */
export interface OrderItemView {
  readonly id: string;
  readonly variantId: string;
  /** Product + variant label frozen when the line was added. */
  readonly nameSnapshot: string;
  readonly quantity: number;
  /** Unit sell price, integer minor units. */
  readonly price: number;
  /** The variant's moving-average cost frozen at add time — stable COGS. */
  readonly costSnapshot: number;
  /**
   * Per-line warehouse override (storefront multi-vendor routing). `null`
   * for every manual/CSV/bulk order — those use the order's single
   * `warehouseId` instead.
   */
  readonly warehouseId: string | null;
}

/** The money block, all integer minor units. `total = subtotal + shippingFee − discount`. */
export interface OrderMoney {
  readonly subtotal: number;
  readonly shippingFee: number;
  readonly discount: number;
  readonly total: number;
  readonly collectedAmount: number;
  readonly paymentStatus: PaymentStatus;
}

/** An order as it appears in a list row (no items). */
export interface OrderListView extends OrderMoney {
  readonly id: string;
  readonly orderNumber: number;
  readonly customerId: string;
  /** The customer's name — plaintext, partially searchable (never the phone). */
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

/** An order as it appears on the detail read: the header plus its items. */
export interface OrderView extends OrderListView {
  readonly notes: string | null;
  readonly items: readonly OrderItemView[];
}

/**
 * One item within a vendor group (Vendor Accounts, Phase 2) — the subset of
 * {@link OrderItemView} the Company Order Tracking view needs; no
 * `costSnapshot` (COGS stays an internal-only figure everywhere it's shown).
 */
export interface OrderVendorGroupItemView {
  readonly id: string;
  readonly variantId: string;
  readonly nameSnapshot: string;
  readonly quantity: number;
  readonly price: number;
  /**
   * The variant's product's display image (Vendor Accounts, Phase 7) — the
   * same `Product.imageUrl` column products already expose; `null` when the
   * product has none. Never a new image system, never touches storage.
   */
  readonly imageUrl: string | null;
}

/**
 * A vendor's slice of one order (Vendor Accounts, Phase 2): the items routed
 * to one warehouse via `order_items.warehouse_id`, plus that warehouse's
 * display info and — if one has joined — the vendor member's identity.
 * `status` is reserved for a later phase's per-vendor lifecycle; always
 * `"new"` today.
 */
export interface OrderVendorGroupView {
  readonly id: string;
  /** The Parent Order this group belongs to — needed by the vendor's own list read. */
  readonly orderId: string;
  readonly orderNumber: number;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly warehouseCode: string | null;
  readonly vendorMemberId: string | null;
  readonly vendorName: string | null;
  readonly status: string;
  /** When `status` (or the group itself) last changed — reuses `updatedAt`, no dedicated column (Phase 3 decision). */
  readonly updatedAt: string;
  readonly items: readonly OrderVendorGroupItemView[];
}

/** One row of the per-order activity log. */
export interface OrderActivityView {
  readonly id: string;
  readonly kind: string;
  readonly fromValue: string | null;
  readonly toValue: string | null;
  readonly note: string | null;
  readonly actorId: string | null;
  readonly createdAt: string;
}

/**
 * The outcome of a create that may have been an idempotent **replay** (same
 * `Idempotency-Key`). A replay wrote nothing, so the service records no audit
 * row and emits no event — the EPIC-9/10 contract.
 */
export interface OrderWriteResult {
  readonly order: OrderView;
  readonly replayed: boolean;
}

/** The outcome of a status transition, carrying what the service needs to emit. */
export interface StatusChangeResult {
  readonly order: OrderView;
  readonly fromStatus: OrderStatus;
  readonly toStatus: OrderStatus;
  /** Set when the transition changed collected money (drives `payment.collected`). */
  readonly collectedDelta: number;
}

/** One item's outcome in a bulk operation (atomic per item, reported per item). */
export interface BulkItemResult {
  readonly orderId: string;
  readonly ok: boolean;
  /** Present when `ok` is false: the api-conventions error code. */
  readonly error?: { readonly code: string; readonly message: string };
}
