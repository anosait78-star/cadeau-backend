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
}

/**
 * Shared cross-feature contract for creating an order from outside the
 * orders feature. The orders feature implements it (`OrdersService.create`
 * structurally satisfies this shape); storefront-integration consumes it
 * instead of importing `orders` directly (architecture rule
 * `no-cross-feature-imports` — same pattern as {@link SessionReissuePort}).
 */
export interface OrdersIngestionPort {
  create(
    principal: RequestPrincipal,
    data: OrdersIngestionInput,
  ): Promise<{ order: { id: string }; replayed: boolean }>;
}

/** DI token for {@link OrdersIngestionPort}. */
export const ORDERS_INGESTION = Symbol("ORDERS_INGESTION");
