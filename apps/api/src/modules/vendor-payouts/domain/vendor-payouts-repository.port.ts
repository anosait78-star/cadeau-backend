import type { KeysetPage } from "@cadeau/database";
import type {
  LedgerEntryView,
  PayoutMethod,
  PayoutView,
  VendorBalanceView,
} from "./vendor-payout.entity";

/** Who is writing: the tenant and the acting user. */
export interface WriteActor {
  readonly companyId: string;
  readonly actorId: string;
}

/** The caller's standing in the company: their warehouse scope (null = staff). */
export interface MemberScope {
  readonly warehouseId: string | null;
}

/** Keyset paging input. */
export interface PageQuery {
  readonly limit?: number;
  readonly cursor?: string;
}

export interface CreatePayoutInput {
  readonly warehouseId: string;
  readonly method: PayoutMethod;
  readonly reference?: string | null;
  readonly notes?: string | null;
  readonly idempotencyKey: string;
}

/** How a pending payout gets confirmed. */
export type ConfirmPayoutInput =
  /** The vendor themself; `warehouseId` must own the payout. */
  | { readonly kind: "vendor"; readonly warehouseId: string }
  /** A manager on the vendor's behalf, with a written reason (decision 7). */
  | { readonly kind: "forced"; readonly reason: string };

export interface CreateAdjustmentInput {
  readonly warehouseId: string;
  /** Signed, non-zero. Positive = the company owes more; negative = less. */
  readonly amountMinor: number;
  readonly note: string;
}

/**
 * Port for the vendor ledger and payouts. Every method runs in one tenant
 * transaction with both the company and the acting user bound, so the
 * warehouse-scoped RLS policies apply to vendors as well as the service's own
 * checks.
 */
export interface VendorPayoutsRepositoryPort {
  /** The caller's active membership scope, or null when they are not a member. */
  findMemberScope(companyId: string, userId: string): Promise<MemberScope | null>;

  /** Every vendor warehouse of the company with its balance, by name. */
  listVendorBalances(companyId: string, userId: string): Promise<readonly VendorBalanceView[]>;

  /** One vendor's balance, or null when the warehouse is not a vendor's. */
  getVendorBalance(
    companyId: string,
    userId: string,
    warehouseId: string,
  ): Promise<VendorBalanceView | null>;

  /** A vendor's statement, newest first. */
  listLedger(
    companyId: string,
    userId: string,
    warehouseId: string,
    query: PageQuery,
  ): Promise<KeysetPage<LedgerEntryView>>;

  /** Payouts, newest first — one vendor's, or the whole company's when `warehouseId` is null. */
  listPayouts(
    companyId: string,
    userId: string,
    warehouseId: string | null,
    query: PageQuery,
  ): Promise<KeysetPage<PayoutView>>;

  findPayout(companyId: string, userId: string, payoutId: string): Promise<PayoutView | null>;

  /**
   * Request a payout of everything owed right now: links every open, priced
   * row of the warehouse to a new pending payout whose amount is their sum.
   * Replays an already-used idempotency key instead of paying twice.
   * Throws `VendorNotFoundError`, `NothingToPayError`,
   * `PayoutAlreadyPendingError`, `IdempotencyKeyReusedError`.
   */
  createPayout(
    actor: WriteActor,
    input: CreatePayoutInput,
  ): Promise<{ readonly payout: PayoutView; readonly replayed: boolean }>;

  /**
   * Confirm a pending payout, settling exactly the rows it holds. Throws
   * `PayoutNotFoundError` (absent, or another vendor's), `PayoutNotPendingError`,
   * `PayoutPeriodClosedError`.
   */
  confirmPayout(
    actor: WriteActor,
    payoutId: string,
    input: ConfirmPayoutInput,
  ): Promise<PayoutView>;

  /** Cancel a pending payout and release its rows back to open. */
  cancelPayout(actor: WriteActor, payoutId: string): Promise<PayoutView>;

  /** A manual correction on a vendor's account. Throws `VendorNotFoundError`. */
  createAdjustment(actor: WriteActor, input: CreateAdjustmentInput): Promise<LedgerEntryView>;
}

/** DI token for {@link VendorPayoutsRepositoryPort}. */
export const VENDOR_PAYOUTS_REPOSITORY = Symbol("VENDOR_PAYOUTS_REPOSITORY");
