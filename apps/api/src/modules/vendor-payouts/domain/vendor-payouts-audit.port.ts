/**
 * A durable, tenant-scoped audit record for a vendor-payouts write. `changes`
 * carries ids, amounts and statuses only — never free text a user typed
 * (payout notes, adjustment notes, force reasons), which may name people.
 * Lengths stand in for them where the fact that one was given matters.
 */
export interface VendorPayoutsAuditRecord {
  readonly companyId: string;
  readonly actorId: string | null;
  readonly action:
    | "vendor_payout.requested"
    | "vendor_payout.confirmed"
    | "vendor_payout.cancelled"
    | "vendor_ledger.adjusted";
  readonly entityType: "vendor_payout" | "vendor_ledger_entry";
  readonly entityId: string;
  readonly changes?: unknown;
}

/** Port for recording vendor-payouts writes to the append-only `audit_log`. */
export interface VendorPayoutsAuditPort {
  record(record: VendorPayoutsAuditRecord): Promise<void>;
}

/** DI token for {@link VendorPayoutsAuditPort}. */
export const VENDOR_PAYOUTS_AUDIT = Symbol("VENDOR_PAYOUTS_AUDIT");
