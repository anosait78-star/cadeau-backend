/**
 * Inventory domain views (EPIC-9). The shapes the application layer returns and
 * the presentation layer renders — decoupled from the Prisma row. Quantities are
 * whole units (never money), carried as JS numbers: stock counts stay far below
 * `Number.MAX_SAFE_INTEGER`, and the database column is `bigint` for headroom.
 */

/** A stock location. */
export interface WarehouseView {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly address: string | null;
  /** At most one warehouse per company is the default. */
  readonly isDefault: boolean;
  /** Soft-delete flag; `false` means archived. */
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A stock level for one (warehouse, variant) pair.
 *
 * The variant's catalog identity (`productName`, `variantName`, `sku`,
 * `imageUrl`) is denormalized onto every row on purpose. A stock row is
 * meaningless to a human without it, and resolving it client-side means
 * paging the whole catalog just to label one page of stock — which silently
 * degrades to raw uuids as soon as the catalog outgrows a single page.
 * Reading it here costs one join the database already indexes.
 */
export interface StockLevelView {
  readonly id: string;
  readonly warehouseId: string;
  readonly variantId: string;
  /** The variant's own name (e.g. a size or colour). */
  readonly variantName: string;
  /** The variant's parent product. */
  readonly productId: string;
  readonly productName: string;
  /** The variant's stock-keeping unit, when it has one. */
  readonly sku: string | null;
  /** The parent product's display image; hosted elsewhere, never file bytes. */
  readonly imageUrl: string | null;
  /** Physical stock on the shelf. */
  readonly onHand: number;
  /** Reserved but not yet shipped. */
  readonly committed: number;
  /** Derived: `onHand - committed`. */
  readonly available: number;
  /** Low-stock threshold; `available <= reorderPoint` raises `stock.low`. */
  readonly reorderPoint: number;
  readonly updatedAt: string;
}

/**
 * The status of a warehouse's join code (Vendor Accounts, Phase 1) — never the
 * plaintext. `exists: false` means no code has been created for this
 * warehouse yet.
 */
export type WarehouseJoinCodeStatusView =
  | { readonly exists: false }
  | { readonly exists: true; readonly isActive: boolean; readonly createdAt: string };

/**
 * A freshly created/rotated join code, including its one-time plaintext. Shown
 * once, like an {@link Invitation} code — the server stores only its hash and
 * can never redisplay it.
 */
export interface WarehouseJoinCodeCreatedView {
  readonly code: string;
  readonly createdAt: string;
}

/** An outstanding (or released) commitment against a stock level. */
export interface ReservationView {
  readonly id: string;
  readonly warehouseId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly orderId: string | null;
  readonly reference: string | null;
  readonly status: "active" | "released";
  readonly releasedAt: string | null;
  readonly createdAt: string;
}

/** A completed move of stock between two warehouses. */
export interface TransferView {
  readonly id: string;
  readonly fromWarehouseId: string;
  readonly toWarehouseId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly note: string | null;
  readonly createdAt: string;
}

/** A completed, reason-coded correction to on-hand stock. */
export interface AdjustmentView {
  readonly id: string;
  readonly warehouseId: string;
  readonly variantId: string;
  /** Signed: positive raised on-hand, negative lowered it. */
  readonly quantityDelta: number;
  readonly reason: AdjustmentReason;
  readonly note: string | null;
  readonly createdAt: string;
}

/**
 * The closed set of adjustment reason codes (mirrors the DB CHECK).
 * `storefront_sync` is written exclusively by the storefront-integration
 * module when an ingested product's `stockQuantity` differs from on-hand
 * (storefront-integration §D5) — no new calculation logic, just a new code.
 */
export const ADJUSTMENT_REASONS = [
  "count",
  "damage",
  "loss",
  "return",
  "other",
  "storefront_sync",
] as const;

/** A reason code for a stock adjustment. */
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

/** Which of the four write paths moved a level. */
export type StockChangeReason = "reserved" | "released" | "transferred" | "adjusted";

/**
 * The effect one atomic stock write had on a single level. The service turns
 * each effect into a `stock.changed` event, and into `stock.low` when the write
 * pushed `available` down to or below the reorder point (edge-triggered: the
 * level was above the threshold before the write).
 */
export interface StockEffect {
  readonly warehouseId: string;
  readonly variantId: string;
  /** Which write path moved this level. */
  readonly reason: StockChangeReason;
  /** Signed change in on-hand units. */
  readonly onHandDelta: number;
  /** Signed change in committed units. */
  readonly committedDelta: number;
  /** The level after the write. */
  readonly level: StockLevelView;
  /** True when this write crossed the reorder threshold from above. */
  readonly crossedLow: boolean;
}

/**
 * The outcome of an atomic stock write: the durable log row, the levels it
 * moved, and whether this was an idempotent **replay** of an earlier request
 * (same `Idempotency-Key`). A replay moved no stock, so `effects` is empty and
 * the service emits nothing.
 */
export interface StockWriteResult<T> {
  readonly record: T;
  readonly effects: readonly StockEffect[];
  readonly replayed: boolean;
}
