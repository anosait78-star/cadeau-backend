/** A durable, tenant-scoped audit record for a finance change. */
export interface FinanceAuditRecord {
  readonly companyId: string;
  readonly actorId: string;
  readonly action:
    | "supplier.created"
    | "supplier.updated"
    | "supplier.archived"
    | "purchase_order.created"
    | "purchase_order.received"
    | "purchase_order.payment_recorded"
    | "expense.created"
    | "expense.updated"
    | "tax_settings.updated"
    | "invoice.issued"
    | "refund.issued"
    | "shipping_reconciliation.created"
    | "period.closed";
  /** The kind of row the change landed on. */
  readonly entityType:
    | "supplier"
    | "purchase_order"
    | "purchase_order_receipt"
    | "purchase_order_payment"
    | "expense"
    | "tax_settings"
    | "invoice"
    | "refund"
    | "shipping_reconciliation"
    | "accounting_period";
  /** The affected row's id. */
  readonly entityId: string;
  /** A secret-free snapshot of what changed. */
  readonly changes?: unknown;
}

/**
 * Port for recording finance changes to the durable, append-only `audit_log`
 * (EPIC-3). This durable write is the source of truth; the additive
 * `purchase_order.received`/`payment.recorded` event-bus emissions ride
 * alongside it (never replace it), always written **after** the audit row
 * (ADR-0004: audit-then-emit). Implementations MUST NOT record secrets.
 */
export interface FinanceAuditPort {
  record(record: FinanceAuditRecord): Promise<void>;
}

/** DI token for {@link FinanceAuditPort}. */
export const FINANCE_AUDIT = Symbol("FINANCE_AUDIT");
