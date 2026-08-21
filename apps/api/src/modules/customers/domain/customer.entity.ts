/**
 * Customer domain views (EPIC-10). The shapes the application layer returns and
 * the presentation layer renders — decoupled from the Prisma row, and from the
 * two columns the phone is actually stored in.
 *
 * **The list and detail views are separate types on purpose.** A list row can
 * only ever carry a masked phone, and it is the *type system* that guarantees
 * it: there is no field on {@link CustomerListView} that could hold a full
 * number, so a future refactor cannot accidentally widen a page of customers
 * into a bulk PII response. See `docs/privacy-model.md` §6.
 */

/** Derived KPI columns — EPIC-11 computes these; nothing in EPIC-10 writes them. */
export interface CustomerKpis {
  /** Orders placed by this customer. `0` until EPIC-11. */
  readonly ordersCount: number;
  /** Lifetime spend in integer minor units (api-conventions §money). `0` until EPIC-11. */
  readonly totalSpent: number;
  /** When the customer last ordered, or `null`. Always `null` until EPIC-11. */
  readonly lastOrderAt: string | null;
}

/** A customer as it appears in a list: the phone is **masked**, never full. */
export interface CustomerListView extends CustomerKpis {
  readonly id: string;
  readonly name: string;
  /** e.g. `+2010•••4567`. There is deliberately no full-phone field here. */
  readonly phoneMasked: string;
  readonly email: string | null;
  /** Soft-delete flag; `false` means archived. */
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A customer as it appears on the detail read: the full phone is decrypted. */
export interface CustomerView extends CustomerKpis {
  readonly id: string;
  readonly name: string;
  /** The full E.164 number. Only ever returned by a single-customer read. */
  readonly phone: string;
  readonly email: string | null;
  readonly notes: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A customer delivery address. */
export interface CustomerAddressView {
  readonly id: string;
  readonly customerId: string;
  /** The decrypted address line. */
  readonly line: string;
  readonly landmark: string | null;
  readonly notes: string | null;
  readonly governorateId: string | null;
  /** Bosta's own city/district ids + the city's display name (real-carrier integration). */
  readonly bostaCityId: string | null;
  readonly bostaDistrictId: string | null;
  readonly bostaCityName: string | null;
  /** At most one address per customer is the default. */
  readonly isDefault: boolean;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The detail read: a customer plus its addresses. */
export interface CustomerWithAddresses extends CustomerView {
  readonly addresses: readonly CustomerAddressView[];
}

/**
 * The review summary attached to a row of a customer's order history, if the
 * order has one. Same `no-cross-feature-imports` rationale as
 * {@link CustomerOrderSummaryView}: a local type, not an import from the
 * `reviews` module's own view types.
 */
export interface CustomerOrderReviewSummary {
  readonly id: string;
  readonly productType: string;
  readonly qualityRating: number;
  readonly packagingRating: number;
  readonly shippingRating: number;
  readonly averageRating: number;
  readonly createdAt: string;
}

/**
 * A row of a customer's order history (EPIC-11, `GET /v1/customers/{id}/orders`).
 * A summary of the order the customers module is allowed to surface without
 * reaching into the orders module's own view types (`no-cross-feature-imports`);
 * the full order lives behind `/v1/orders/{orderId}`.
 */
export interface CustomerOrderSummaryView {
  readonly id: string;
  readonly orderNumber: number;
  readonly status: string;
  readonly total: number;
  readonly collectedAmount: number;
  readonly createdAt: string;
  /** `null` when the order has no review yet — a normal state, not an error. */
  readonly review: CustomerOrderReviewSummary | null;
}

/** The outcome of a merge: the ids that were folded together. */
export interface CustomerMergeResult {
  readonly survivingCustomerId: string;
  readonly mergedCustomerId: string;
}

/**
 * The outcome of a create that may have been an idempotent **replay** of an
 * earlier request (same `Idempotency-Key`). A replay wrote nothing, so the
 * service records no audit row and emits no event — the same contract the
 * inventory module established in EPIC-9.
 */
export interface CustomerWriteResult {
  readonly customer: CustomerView;
  readonly replayed: boolean;
}
