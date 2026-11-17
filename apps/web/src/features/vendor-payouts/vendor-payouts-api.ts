import { apiFetch } from "@/lib/api-client";

/** How the company paid a vendor (matches the backend's closed set). */
export const PAYOUT_METHODS = ["cash", "bank_transfer", "instapay", "wallet", "other"] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

export type PayoutStatus = "pending" | "confirmed" | "cancelled";
export type LedgerEntryKind = "accrual" | "return_reversal" | "adjustment";
export type LedgerEntryState = "open" | "pending" | "settled";

/** One vendor's position with the company. Money is integer minor units. */
export interface VendorBalance {
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly vendorName: string | null;
  /** Owed now: what a new payout would carry. */
  readonly owedMinor: number;
  /** Held by the payout waiting for the vendor's confirmation. */
  readonly pendingMinor: number;
  readonly paidMinor: number;
  /** Delivered lines still waiting for a wholesale price (counted at zero). */
  readonly needsPricingCount: number;
  readonly pendingPayoutId: string | null;
}

export interface LedgerEntry {
  readonly id: string;
  readonly kind: LedgerEntryKind;
  readonly orderId: string | null;
  readonly orderNumber: number | null;
  readonly variantId: string | null;
  readonly nameSnapshot: string | null;
  readonly quantity: number | null;
  readonly unitCostMinor: number | null;
  /** Signed: reversals and negative adjustments are below zero. */
  readonly amountMinor: number;
  readonly needsPricing: boolean;
  readonly payoutId: string | null;
  readonly state: LedgerEntryState;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface VendorPayout {
  readonly id: string;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly amountMinor: number;
  readonly method: PayoutMethod;
  readonly reference: string | null;
  readonly notes: string | null;
  readonly status: PayoutStatus;
  readonly confirmationKind: "vendor" | "forced" | null;
  readonly forceReason: string | null;
  readonly confirmedAt: string | null;
  readonly cancelledAt: string | null;
  readonly entryCount: number;
  readonly createdAt: string;
}

export interface Page<T> {
  readonly data: T[];
  readonly page: {
    readonly limit: number;
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

function pageQuery(cursor?: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(extra);
  if (cursor !== undefined) params.set("cursor", cursor);
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : "";
}

// ---- company side ------------------------------------------------------------

export function listVendorBalances(): Promise<{ data: VendorBalance[] }> {
  return apiFetch<{ data: VendorBalance[] }>("/vendor-payouts/vendors");
}

export function getVendorBalance(warehouseId: string): Promise<VendorBalance> {
  return apiFetch<VendorBalance>(`/vendor-payouts/vendors/${warehouseId}`);
}

export function listVendorLedger(warehouseId: string, cursor?: string): Promise<Page<LedgerEntry>> {
  return apiFetch<Page<LedgerEntry>>(
    `/vendor-payouts/vendors/${warehouseId}/ledger${pageQuery(cursor)}`,
  );
}

export function listVendorPayouts(
  warehouseId: string,
  cursor?: string,
): Promise<Page<VendorPayout>> {
  return apiFetch<Page<VendorPayout>>(
    `/vendor-payouts/payouts${pageQuery(cursor, { warehouseId })}`,
  );
}

export interface RequestPayoutInput {
  readonly method: PayoutMethod;
  readonly reference?: string;
  readonly notes?: string;
}

/**
 * `POST /vendor-payouts/vendors/:id/payouts` — pay everything owed right now.
 * The caller passes one key per user action, so a double click or a retry
 * after a network blip replays the same payout instead of creating a second.
 */
export function requestVendorPayout(
  warehouseId: string,
  body: RequestPayoutInput,
  idempotencyKey: string,
): Promise<VendorPayout> {
  return apiFetch<VendorPayout>(`/vendor-payouts/vendors/${warehouseId}/payouts`, {
    method: "POST",
    body,
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export function cancelVendorPayout(payoutId: string): Promise<VendorPayout> {
  return apiFetch<VendorPayout>(`/vendor-payouts/payouts/${payoutId}/cancel`, { method: "POST" });
}

export function forceConfirmVendorPayout(payoutId: string, reason: string): Promise<VendorPayout> {
  return apiFetch<VendorPayout>(`/vendor-payouts/payouts/${payoutId}/force-confirm`, {
    method: "POST",
    body: { reason },
  });
}

export function createVendorAdjustment(
  warehouseId: string,
  body: { readonly amountMinor: number; readonly note: string },
): Promise<LedgerEntry> {
  return apiFetch<LedgerEntry>(`/vendor-payouts/vendors/${warehouseId}/adjustments`, {
    method: "POST",
    body,
  });
}

// ---- vendor side -------------------------------------------------------------

export function getMyVendorAccount(): Promise<VendorBalance> {
  return apiFetch<VendorBalance>("/vendor/account");
}

export function listMyVendorLedger(cursor?: string): Promise<Page<LedgerEntry>> {
  return apiFetch<Page<LedgerEntry>>(`/vendor/account/ledger${pageQuery(cursor)}`);
}

export function listMyVendorPayouts(cursor?: string): Promise<Page<VendorPayout>> {
  return apiFetch<Page<VendorPayout>>(`/vendor/account/payouts${pageQuery(cursor)}`);
}

/** "استلمت المبلغ" — settles the vendor's own pending payout. */
export function confirmMyVendorPayout(payoutId: string): Promise<VendorPayout> {
  return apiFetch<VendorPayout>(`/vendor/account/payouts/${payoutId}/confirm`, {
    method: "POST",
  });
}
