/**
 * Vendor payouts — read models (2026-11-17). Money is always an integer count
 * of minor units (api-conventions §money); dates are ISO-8601 strings.
 *
 * A vendor's account is their warehouse's ledger. Every row is in exactly one
 * of three states, derived from the payout that holds it:
 *
 * - `open`     — no payout yet: still owed (unless it is waiting for a price).
 * - `pending`  — held by a payout the vendor has not confirmed yet.
 * - `settled`  — held by a confirmed payout: paid.
 */

/** How the company paid. A closed set, matching `vendor_payouts_method_check`. */
export const PAYOUT_METHODS = ["cash", "bank_transfer", "instapay", "wallet", "other"] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

export type PayoutStatus = "pending" | "confirmed" | "cancelled";

/** Who confirmed a payout: the vendor, or a manager on their behalf. */
export type PayoutConfirmationKind = "vendor" | "forced";

export type LedgerEntryKind = "accrual" | "return_reversal" | "adjustment";

export type LedgerEntryState = "open" | "pending" | "settled";

/** One vendor's position, as the company's vendors list and the vendor's own account show it. */
export interface VendorBalanceView {
  readonly warehouseId: string;
  readonly warehouseName: string;
  /** The vendor account's display name, or null when no account has joined yet. */
  readonly vendorName: string | null;
  /** Open, priced rows: what a new payout would carry right now. */
  readonly owedMinor: number;
  /** Rows held by the pending payout, if any. */
  readonly pendingMinor: number;
  /** Sum of every confirmed payout. */
  readonly paidMinor: number;
  /** Open rows still waiting for a wholesale price (counted, not summed: they are zero). */
  readonly needsPricingCount: number;
  readonly pendingPayoutId: string | null;
}

/** One line of a vendor's statement. */
export interface LedgerEntryView {
  readonly id: string;
  readonly kind: LedgerEntryKind;
  readonly orderId: string | null;
  readonly orderNumber: number | null;
  readonly variantId: string | null;
  readonly nameSnapshot: string | null;
  readonly quantity: number | null;
  readonly unitCostMinor: number | null;
  /** Signed: a reversal or a negative adjustment is below zero. */
  readonly amountMinor: number;
  readonly needsPricing: boolean;
  readonly payoutId: string | null;
  readonly state: LedgerEntryState;
  /** A manual adjustment's reason; null for order-driven rows. */
  readonly note: string | null;
  readonly createdAt: string;
}

/** A payout request and where it stands. */
export interface PayoutView {
  readonly id: string;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly amountMinor: number;
  readonly method: PayoutMethod;
  readonly reference: string | null;
  readonly notes: string | null;
  readonly status: PayoutStatus;
  readonly confirmationKind: PayoutConfirmationKind | null;
  readonly forceReason: string | null;
  readonly confirmedAt: string | null;
  readonly cancelledAt: string | null;
  readonly entryCount: number;
  readonly createdAt: string;
}

/** The state a ledger row is in, from its payout's status (null = no payout). */
export function ledgerEntryStateOf(payoutStatus: PayoutStatus | null): LedgerEntryState {
  if (payoutStatus === "confirmed") return "settled";
  if (payoutStatus === "pending") return "pending";
  // No payout, or a cancelled one (whose rows were unlinked — defensive).
  return "open";
}

export function isPayoutMethod(value: string): value is PayoutMethod {
  return (PAYOUT_METHODS as readonly string[]).includes(value);
}
