import type { RequestPrincipal } from "../auth/authenticated-request";

/** One line of an order created through this contract. */
export interface OrdersIngestionItem {
  readonly variantId: string;
  readonly quantity: number;
  /** Unit sell price, integer minor units. */
  readonly price: number;
  /**
   * Per-line warehouse override (storefront multi-vendor routing). Omitted
   * for every non-multi-vendor order, which keeps using the order-level
   * `warehouseId` below exactly as before this field existed.
   */
  readonly warehouseId?: string | null;
}

/** The subset of `CreateOrderInput` the storefront-integration module needs. */
export interface OrdersIngestionInput {
  readonly customerId: string;
  readonly warehouseId?: string | null;
  readonly notes?: string | null;
  readonly items: readonly OrdersIngestionItem[];
  readonly shippingFee?: number;
  readonly isGiftWrap?: boolean;
  readonly giftWrapFeeMinor?: number;
  /**
   * The storefront confirmed this order paid at checkout (WooCommerce:
   * `date_paid !== null`) — `collectedAmount`/`paymentStatus` are set from
   * whatever `total` this create computes, never a figure guessed here
   * (D4: no duplicated business logic).
   */
  readonly markFullyPaid?: boolean;
}

/**
 * The mutable fields a later storefront event (`order.updated`) can re-sync
 * onto an already-ingested order — deliberately narrow: never items/pricing,
 * only facts that can legitimately change after checkout (payment
 * confirmation on a redirect gateway, a gift-wrap choice, a shipping-fee
 * correction). See `StorefrontIngestionService`'s update-sync path.
 */
export interface OrdersIngestionUpdateInput {
  readonly shippingFee?: number;
  readonly isGiftWrap?: boolean;
  readonly giftWrapFeeMinor?: number;
  readonly markFullyPaid?: boolean;
}

/**
 * Shared cross-feature contract for creating/updating an order from outside
 * the orders feature. The orders feature implements it (`OrdersService`
 * structurally satisfies this shape); storefront-integration consumes it
 * instead of importing `orders` directly (architecture rule
 * `no-cross-feature-imports` — same pattern as {@link SessionReissuePort}).
 */
export interface OrdersIngestionPort {
  create(
    principal: RequestPrincipal,
    data: OrdersIngestionInput,
  ): Promise<{ order: { id: string }; replayed: boolean }>;
  /**
   * Named distinctly from `OrdersService.update` (same class, `useExisting`
   * binding, D — orders-ingestion.port): that method's public signature/return
   * shape is the orders controller's own contract and must not be reshaped
   * for this narrower internal caller.
   */
  updateForStorefront(
    principal: RequestPrincipal,
    orderId: string,
    data: OrdersIngestionUpdateInput,
  ): Promise<{ order: { id: string } }>;
  /**
   * Cancels an order the storefront itself reports as cancelled/failed —
   * found live (2026-09-07): a cancelled WooCommerce order was still being
   * synced in as a normal, active CRM order. A no-op (never throws) when the
   * order is already cancelled, or when cancelling isn't a valid transition
   * from its current status (e.g. already shipped) — a resync must never
   * fail the whole event over this.
   */
  cancelForStorefront(principal: RequestPrincipal, orderId: string): Promise<void>;
}

/** DI token for {@link OrdersIngestionPort}. */
export const ORDERS_INGESTION = Symbol("ORDERS_INGESTION");
