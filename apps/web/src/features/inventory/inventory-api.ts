import { apiFetch } from "@/lib/api-client";
import { buildQuery } from "@/lib/build-query";

/** A stock location. */
export interface Warehouse {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly address: string | null;
  readonly isDefault: boolean;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A stock level for one (warehouse, variant) pair. `available` is read-only. */
export interface StockLevel {
  readonly id: string;
  readonly warehouseId: string;
  readonly variantId: string;
  readonly onHand: number;
  readonly committed: number;
  readonly available: number;
  readonly reorderPoint: number;
  readonly updatedAt: string;
}

/** A completed, reason-coded stock correction. */
export interface Adjustment {
  readonly id: string;
  readonly warehouseId: string;
  readonly variantId: string;
  readonly quantityDelta: number;
  readonly reason: AdjustmentReason;
  readonly note: string | null;
  readonly createdAt: string;
}

/** A completed move between two warehouses. */
export interface Transfer {
  readonly id: string;
  readonly fromWarehouseId: string;
  readonly toWarehouseId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly note: string | null;
  readonly createdAt: string;
}

/** The reason codes the API accepts for an adjustment. */
export const ADJUSTMENT_REASONS = ["count", "damage", "loss", "return", "other"] as const;

/** A reason code for a stock adjustment. */
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

/** A keyset page (api-conventions §5). */
export interface Page<T> {
  readonly data: T[];
  readonly page: {
    readonly limit: number;
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

/** Query options for the warehouses list. */
export interface WarehouseListOptions {
  readonly cursor?: string;
  /** `true` = active only, `false` = archived only, `"all"` = both. */
  readonly active?: boolean | "all";
  readonly q?: string;
}

/** Query options for the stock list. */
export interface StockListOptions {
  readonly cursor?: string;
  readonly warehouseId?: string;
  readonly variantId?: string;
  /** Only levels at or below their reorder point. */
  readonly belowReorder?: boolean;
  readonly sort?: "available" | "-available" | "updatedAt" | "-updatedAt";
}

/** Create/update warehouse body. Send `null` to clear an optional field. */
export interface WarehouseInput {
  readonly name?: string;
  readonly code?: string | null;
  readonly address?: string | null;
  readonly isDefault?: boolean;
  readonly active?: boolean;
}

/**
 * `GET /v1/warehouses` — every caller treats this as the company's complete
 * warehouse set (a dropdown/filter source, never a browsable paginated
 * list), so this walks every keyset page itself and returns the flat
 * result — a company with more warehouses than the API's page size no
 * longer loses the rest of them silently.
 */
export async function listWarehouses(options: WarehouseListOptions = {}): Promise<Warehouse[]> {
  const all: Warehouse[] = [];
  let cursor = options.cursor;
  for (;;) {
    const page = await apiFetch<Page<Warehouse>>(
      `/warehouses${buildQuery({
        cursor,
        active: options.active === undefined ? undefined : String(options.active),
        q: options.q,
        sort: "name",
      })}`,
    );
    all.push(...page.data);
    if (!page.page.hasMore || page.page.nextCursor === null) break;
    cursor = page.page.nextCursor;
  }
  return all;
}

/** `POST /v1/warehouses` — create a stock location. */
export function createWarehouse(body: WarehouseInput): Promise<Warehouse> {
  return apiFetch<Warehouse>("/warehouses", { method: "POST", body });
}

/** `PATCH /v1/warehouses/{id}` — update a stock location. */
export function updateWarehouse(id: string, body: WarehouseInput): Promise<Warehouse> {
  return apiFetch<Warehouse>(`/warehouses/${id}`, { method: "PATCH", body });
}

/** `DELETE /v1/warehouses/{id}` — archive a stock location (soft-delete). */
export function archiveWarehouse(id: string): Promise<void> {
  return apiFetch<void>(`/warehouses/${id}`, { method: "DELETE" });
}

/** A warehouse's join-code status (Vendor Accounts, Phase 1) — never the plaintext. */
export type WarehouseJoinCodeStatus =
  | { readonly exists: false }
  | { readonly exists: true; readonly isActive: boolean; readonly createdAt: string };

/** A freshly rotated join code, including its one-time plaintext. */
export interface WarehouseJoinCodeCreated {
  readonly code: string;
  readonly createdAt: string;
}

/** `GET /v1/warehouses/{id}/join-code` — status only, never the plaintext. */
export function getWarehouseJoinCode(warehouseId: string): Promise<WarehouseJoinCodeStatus> {
  return apiFetch<WarehouseJoinCodeStatus>(`/warehouses/${warehouseId}/join-code`);
}

/**
 * `POST /v1/warehouses/{id}/join-code/rotate` — issue a fresh join code,
 * invalidating any previous one. Shown once: the server stores only its hash.
 */
export function rotateWarehouseJoinCode(warehouseId: string): Promise<WarehouseJoinCodeCreated> {
  return apiFetch<WarehouseJoinCodeCreated>(`/warehouses/${warehouseId}/join-code/rotate`, {
    method: "POST",
  });
}

/** `DELETE /v1/warehouses/{id}/join-code` — revoke the warehouse's join code. */
export function revokeWarehouseJoinCode(warehouseId: string): Promise<void> {
  return apiFetch<void>(`/warehouses/${warehouseId}/join-code`, { method: "DELETE" });
}

/** `GET /v1/inventory/stock` — keyset-paginated stock levels. */
export function listStock(options: StockListOptions = {}): Promise<Page<StockLevel>> {
  return apiFetch<Page<StockLevel>>(
    `/inventory/stock${buildQuery({
      cursor: options.cursor,
      warehouseId: options.warehouseId,
      variantId: options.variantId,
      belowReorder: options.belowReorder === true ? "true" : undefined,
      sort: options.sort,
    })}`,
  );
}

/** `PUT /v1/inventory/reorder-points` — set a level's low-stock threshold. */
export function setReorderPoint(body: {
  warehouseId: string;
  variantId: string;
  reorderPoint: number;
}): Promise<StockLevel> {
  return apiFetch<StockLevel>("/inventory/reorder-points", { method: "PUT", body });
}

/** `POST /v1/inventory/adjustments` — correct on-hand stock with a reason. */
export function createAdjustment(body: {
  warehouseId: string;
  variantId: string;
  quantityDelta: number;
  reason: AdjustmentReason;
  note?: string | null;
}): Promise<Adjustment> {
  return apiFetch<Adjustment>("/inventory/adjustments", { method: "POST", body });
}

/**
 * `PUT /v1/inventory/variant-warehouse` — assign a variant to a warehouse
 * with no quantity claim (creates a zero-value row if none exists there yet,
 * and drops the variant's other already-empty rows). If the variant still
 * holds real stock in a different warehouse, move it with {@link createTransfer}
 * first — this call leaves rows with on-hand or committed units untouched.
 */
export function setVariantWarehouse(body: {
  warehouseId: string;
  variantId: string;
}): Promise<StockLevel> {
  return apiFetch<StockLevel>("/inventory/variant-warehouse", { method: "PUT", body });
}

/** `POST /v1/inventory/transfers` — move stock between two warehouses. */
export function createTransfer(body: {
  fromWarehouseId: string;
  toWarehouseId: string;
  variantId: string;
  quantity: number;
  note?: string | null;
}): Promise<Transfer> {
  return apiFetch<Transfer>("/inventory/transfers", { method: "POST", body });
}
