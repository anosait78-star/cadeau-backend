/**
 * The orders side of vendor payouts (2026-11-17): which order transitions owe
 * a vendor money, how much, and when an order's lines stop being editable.
 * Pure data + functions — the repository does the I/O inside the transition's
 * own transaction, so a delivered order and its vendor accruals always land
 * (or fail) together.
 *
 * The rules, as decided with the product owner:
 *
 * - A vendor is owed when the **order itself** enters `delivered`. Never the
 *   vendor group's own `delivered`: a vendor sets that one on themselves.
 * - A return after delivery (`delivered`/`completed` → `returned`) mirrors
 *   every accrual with a reversal. A return before delivery owes nothing and
 *   reverses nothing.
 * - Each line accrues at its variant's wholesale cost at that moment, frozen
 *   into the ledger row. A variant with no wholesale cost yet accrues at zero
 *   flagged `needsPricing`, completed later when the price is entered.
 * - Once delivered, an order's lines are locked: what was owed must not
 *   change because someone edited the order afterwards.
 */
import type { OrderStatus } from "./order-status";

/** What a status transition does to the vendor ledger. */
export type VendorLedgerEffect = "accrue" | "reverse" | "none";

/** States after delivery: an order here has (or had) accrued vendor money. */
const POST_DELIVERY_STATES: ReadonlySet<OrderStatus> = new Set([
  "delivered",
  "completed",
  "returned",
  "exchanged",
]);

/** States a return can reverse accruals from (both are past delivery). */
const REVERSIBLE_FROM: ReadonlySet<OrderStatus> = new Set(["delivered", "completed"]);

/** The ledger effect of moving an order from `from` to `to`. */
export function vendorLedgerEffectOf(from: OrderStatus, to: OrderStatus): VendorLedgerEffect {
  if (to === "delivered") return "accrue";
  if (to === "returned" && REVERSIBLE_FROM.has(from)) return "reverse";
  return "none";
}

/** Whether an order in `status` may still have its lines replaced. */
export function canEditOrderItems(status: OrderStatus): boolean {
  return !POST_DELIVERY_STATES.has(status);
}

/** One order line, as the accrual needs it. */
export interface AccruableLine {
  readonly id: string;
  readonly variantId: string;
  readonly nameSnapshot: string;
  readonly quantity: number;
  /** Per-line routing; null falls back to the order's own warehouse. */
  readonly warehouseId: string | null;
  /** The variant's wholesale cost right now; null = not priced yet. */
  readonly wholesaleCostMinor: number | null;
}

/** A ledger accrual to write — one per vendor line. */
export interface VendorAccrual {
  readonly warehouseId: string;
  readonly orderItemId: string;
  readonly variantId: string;
  readonly nameSnapshot: string;
  readonly quantity: number;
  readonly unitCostMinor: number;
  readonly amountMinor: number;
  readonly needsPricing: boolean;
}

/**
 * The warehouse a line was actually fulfilled from: its own routing when set
 * (storefront multi-vendor orders), else the order's warehouse (manual orders,
 * which only ever pick one). Null when neither says.
 */
export function effectiveWarehouseOf(
  line: Pick<AccruableLine, "warehouseId">,
  orderWarehouseId: string | null,
): string | null {
  return line.warehouseId ?? orderWarehouseId;
}

/**
 * The accruals an order's delivery writes: every line fulfilled from a vendor
 * warehouse, at its variant's wholesale cost. Lines from the company's own
 * warehouses owe nobody and are skipped.
 */
export function buildVendorAccruals(
  lines: readonly AccruableLine[],
  orderWarehouseId: string | null,
  vendorWarehouseIds: ReadonlySet<string>,
): VendorAccrual[] {
  const accruals: VendorAccrual[] = [];
  for (const line of lines) {
    const warehouseId = effectiveWarehouseOf(line, orderWarehouseId);
    if (warehouseId === null || !vendorWarehouseIds.has(warehouseId)) continue;
    const needsPricing = line.wholesaleCostMinor === null;
    const unitCostMinor = line.wholesaleCostMinor ?? 0;
    accruals.push({
      warehouseId,
      orderItemId: line.id,
      variantId: line.variantId,
      nameSnapshot: line.nameSnapshot,
      quantity: line.quantity,
      unitCostMinor,
      amountMinor: unitCostMinor * line.quantity,
      needsPricing,
    });
  }
  return accruals;
}
