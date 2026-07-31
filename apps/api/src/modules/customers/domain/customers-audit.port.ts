/**
 * A durable, tenant-scoped audit record for a customer/address change.
 *
 * `changes` must be **PII-free** (docs/privacy-model.md §6). The audit log is the
 * one table platform admins read across tenants, so a customer audit row records
 * *which* fields changed and the row's id — never the phone, the email, the name
 * or the address line.
 */
export interface CustomersAuditRecord {
  readonly companyId: string;
  readonly actorId: string;
  readonly action:
    | "customer.created"
    | "customer.updated"
    | "customer.archived"
    | "customer.exported"
    | "customer.merged"
    | "customer.address_created"
    | "customer.address_updated";
  readonly entityType: "customer" | "customer_address";
  /** The affected row's id. */
  readonly entityId: string;
  /**
   * A PII-free description of the change — typically `{ fields: ["phone"] }`.
   * Never the values themselves.
   */
  readonly changes?: unknown;
}

/**
 * Port for recording customer changes to the durable, append-only `audit_log`
 * (EPIC-3). This durable write is the source of truth; the additive
 * `customer.*` event-bus emission rides alongside it (never replaces it).
 * Implementations MUST NOT record secrets or personal data.
 */
export interface CustomersAuditPort {
  record(record: CustomersAuditRecord): Promise<void>;
}

/** DI token for {@link CustomersAuditPort}. */
export const CUSTOMERS_AUDIT = Symbol("CUSTOMERS_AUDIT");
