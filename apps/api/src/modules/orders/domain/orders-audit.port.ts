/**
 * A durable, tenant-scoped audit record for an order change (EPIC-11).
 *
 * `changes` must be **PII-free** (docs/privacy-model.md §6): an order audit row
 * records ids and field *names* — never the customer phone, name or address.
 */
export interface OrdersAuditRecord {
  readonly companyId: string;
  readonly actorId: string;
  readonly action:
    | "order.created"
    | "order.updated"
    | "order.status_changed"
    | "order.assigned"
    | "order.payment_collected";
  readonly entityType: "order";
  /** The affected order's id. */
  readonly entityId: string;
  /** A PII-free description of the change (e.g. `{ from: "new", to: "processing" }`). */
  readonly changes?: unknown;
}

/**
 * Port for recording order changes to the durable, append-only `audit_log`
 * (EPIC-3). The durable write is the source of truth; the additive `order.*`
 * event-bus emission rides alongside it (never replaces it).
 */
export interface OrdersAuditPort {
  record(record: OrdersAuditRecord): Promise<void>;
}

/** DI token for {@link OrdersAuditPort}. */
export const ORDERS_AUDIT = Symbol("ORDERS_AUDIT");
