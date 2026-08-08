import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../auth/authenticated-request";

export interface StockLevelSummary {
  readonly onHand: number;
}

export interface WarehouseSummary {
  readonly id: string;
  readonly isDefault: boolean;
}

export interface StockListFilter {
  readonly warehouseId?: string;
  readonly variantId?: string;
  readonly limit?: string;
}

export interface WarehouseListFilter {
  readonly limit?: string;
  readonly active?: string;
}

export interface AdjustInput {
  readonly warehouseId: string;
  readonly variantId: string;
  readonly quantityDelta: number;
  readonly reason: "storefront_sync";
  readonly note?: string | null;
}

/**
 * Shared cross-feature contract over inventory stock reads/writes. The
 * inventory feature implements it (`InventoryService` structurally satisfies
 * this shape); storefront-integration consumes it instead of importing
 * `inventory` directly (architecture rule `no-cross-feature-imports`).
 */
export interface InventoryAdjustmentPort {
  listStock(
    principal: RequestPrincipal,
    query: StockListFilter,
  ): Promise<KeysetPage<StockLevelSummary>>;
  listWarehouses(
    principal: RequestPrincipal,
    query: WarehouseListFilter,
  ): Promise<KeysetPage<WarehouseSummary>>;
  adjust(principal: RequestPrincipal, data: AdjustInput): Promise<unknown>;
}

/** DI token for {@link InventoryAdjustmentPort}. */
export const INVENTORY_ADJUSTMENT = Symbol("INVENTORY_ADJUSTMENT");
