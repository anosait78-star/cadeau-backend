/**
 * List-query parsing for `GET /v1/finance/suppliers` and
 * `GET /v1/finance/purchase-orders` (EPIC-13, M13.2). Validates and normalizes
 * the raw query string into a shape the repository can execute, rejecting bad
 * sort/filter values per api-conventions §6/§7. Mirrors the EPIC-9 inventory
 * parser.
 */
import { PURCHASE_ORDER_STATUSES, type PurchaseOrderStatus } from "./finance.entity";

/** A single field error, matching api-conventions §4 (`{ field, messages }`). */
export interface FieldError {
  readonly field: string;
  readonly messages: readonly string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- Suppliers --------------------------------------------------------------

/** Sortable supplier fields (whitelist). `createdAt` is the default (descending). */
export type SupplierSortField = "name" | "createdAt";

/** Raw supplier query params as they arrive (all strings). */
export interface RawSupplierListQuery {
  readonly limit?: string;
  readonly cursor?: string;
  readonly sort?: string;
  readonly q?: string;
  readonly active?: string;
}

/** A normalized, validated supplier list query. */
export interface ParsedSupplierListQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly sort: { readonly field: SupplierSortField; readonly dir: "asc" | "desc" };
  readonly q?: string;
  /** `true` = active only, `false` = archived only, `"all"` = no filter. */
  readonly active: boolean | "all";
}

const SUPPLIER_SORTS: readonly SupplierSortField[] = ["name", "createdAt"];

// ---- Purchase orders ---------------------------------------------------------

/** Sortable purchase-order fields (whitelist). `createdAt` is the default (descending). */
export type PurchaseOrderSortField = "createdAt";

/** Raw purchase-order query params as they arrive (all strings). */
export interface RawPurchaseOrderListQuery {
  readonly limit?: string;
  readonly cursor?: string;
  readonly sort?: string;
  readonly status?: string;
  readonly supplierId?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

/** A normalized, validated purchase-order list query. */
export interface ParsedPurchaseOrderListQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly sort: { readonly field: PurchaseOrderSortField; readonly dir: "asc" | "desc" };
  readonly status?: PurchaseOrderStatus;
  readonly supplierId?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

const PURCHASE_ORDER_SORTS: readonly PurchaseOrderSortField[] = ["createdAt"];

// ---- Expenses (M13.3) --------------------------------------------------------

/** Sortable expense fields (whitelist). `incurredAt` is the default (descending). */
export type ExpenseSortField = "incurredAt";

/** Raw expense query params as they arrive (all strings). */
export interface RawExpenseListQuery {
  readonly limit?: string;
  readonly cursor?: string;
  readonly sort?: string;
  readonly category?: string;
  readonly supplierId?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

/** A normalized, validated expense list query. */
export interface ParsedExpenseListQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly sort: { readonly field: ExpenseSortField; readonly dir: "asc" | "desc" };
  readonly category?: string;
  readonly supplierId?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

const EXPENSE_SORTS: readonly ExpenseSortField[] = ["incurredAt"];

// ---- Invoices (M13.4) --------------------------------------------------------

/** Sortable invoice fields (whitelist, `createdAt` only). */
export type InvoiceSortField = "createdAt";

/** Raw invoice query params as they arrive (all strings). */
export interface RawInvoiceListQuery {
  readonly limit?: string;
  readonly cursor?: string;
  readonly orderId?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

/** A normalized, validated invoice list query. */
export interface ParsedInvoiceListQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly sort: { readonly field: InvoiceSortField; readonly dir: "asc" | "desc" };
  readonly orderId?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

const INVOICE_SORTS: readonly InvoiceSortField[] = ["createdAt"];

// ---- Refunds (M13.4) ---------------------------------------------------------

/** Sortable refund fields (whitelist, `createdAt` only). */
export type RefundSortField = "createdAt";

/** Raw refund query params as they arrive (all strings). */
export interface RawRefundListQuery {
  readonly limit?: string;
  readonly cursor?: string;
  readonly invoiceId?: string;
  readonly orderId?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

/** A normalized, validated refund list query. */
export interface ParsedRefundListQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly sort: { readonly field: RefundSortField; readonly dir: "asc" | "desc" };
  readonly invoiceId?: string;
  readonly orderId?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

const REFUND_SORTS: readonly RefundSortField[] = ["createdAt"];

// ---- Shipping reconciliation (M13.5, D5) --------------------------------------

/** Sortable reconciliation fields (whitelist, `createdAt` only). */
export type ReconciliationSortField = "createdAt";

/** Raw reconciliation query params as they arrive (all strings). */
export interface RawReconciliationListQuery {
  readonly limit?: string;
  readonly cursor?: string;
  readonly carrier?: string;
  readonly periodKey?: string;
}

/** A normalized, validated reconciliation list query. */
export interface ParsedReconciliationListQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly sort: { readonly field: ReconciliationSortField; readonly dir: "asc" | "desc" };
  readonly carrier?: string;
  readonly periodKey?: string;
}

const RECONCILIATION_SORTS: readonly ReconciliationSortField[] = ["createdAt"];

const PERIOD_KEY_RE = /^\d{4}-\d{2}$/;

// ---- Reports (M13.5, D6) -------------------------------------------------------

/** Raw report date-range query params as they arrive (all strings). */
export interface RawReportRangeQuery {
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly compareFrom?: string;
  readonly compareTo?: string;
}

/**
 * A normalized, validated report date range. `dateFrom`/`dateTo` are
 * required; `compareFrom`/`compareTo` are optional but must be provided
 * together (P&L's period-comparison branch).
 */
export interface ParsedReportRangeQuery {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly compareFrom?: string;
  readonly compareTo?: string;
}

// ---- Shared parsing --------------------------------------------------------

/** Parse `?sort=` (a leading `-` means descending) against a whitelist. */
function parseSort<F extends string>(
  raw: string | undefined,
  whitelist: readonly F[],
  fallback: string,
): { sort?: { field: F; dir: "asc" | "desc" }; error?: FieldError } {
  const value = raw ?? fallback;
  const dir: "asc" | "desc" = value.startsWith("-") ? "desc" : "asc";
  const field = value.replace(/^-/, "");
  if (!whitelist.includes(field as F)) {
    return {
      error: {
        field: "sort",
        messages: [`sort must be one of: ${whitelist.join(", ")} (optionally -prefixed)`],
      },
    };
  }
  return { sort: { field: field as F, dir } };
}

/** Parse an `active` tri-state filter. */
function parseActive(raw: string | undefined): { active?: boolean | "all"; error?: FieldError } {
  if (raw === undefined) return { active: true };
  if (raw === "true") return { active: true };
  if (raw === "false") return { active: false };
  if (raw === "all") return { active: "all" };
  return { error: { field: "active", messages: ["active must be true, false, or all"] } };
}

/** Validate an optional uuid filter, pushing a field error when malformed. */
function checkUuid(field: string, raw: string | undefined, errors: FieldError[]): void {
  if (raw !== undefined && !UUID_RE.test(raw)) {
    errors.push({ field, messages: [`${field} must be a uuid`] });
  }
}

/** Validate an optional ISO date-time filter, pushing a field error when malformed. */
function checkDate(field: string, raw: string | undefined, errors: FieldError[]): void {
  if (raw !== undefined && Number.isNaN(Date.parse(raw))) {
    errors.push({ field, messages: [`${field} must be an ISO-8601 date-time`] });
  }
}

/**
 * Validate + normalize the supplier list query. The caller renders the
 * returned errors into a `400 VALIDATION_FAILED`.
 */
export function parseSupplierListQuery(raw: RawSupplierListQuery): {
  query?: ParsedSupplierListQuery;
  errors: FieldError[];
} {
  const errors: FieldError[] = [];

  const { sort, error: sortError } = parseSort(raw.sort, SUPPLIER_SORTS, "-createdAt");
  if (sortError !== undefined) errors.push(sortError);

  const { active, error: activeError } = parseActive(raw.active);
  if (activeError !== undefined) errors.push(activeError);

  if (errors.length > 0 || sort === undefined || active === undefined) return { errors };

  const query: ParsedSupplierListQuery = {
    ...(raw.limit !== undefined ? { limit: Number(raw.limit) } : {}),
    ...(raw.cursor !== undefined ? { cursor: raw.cursor } : {}),
    sort,
    ...(raw.q !== undefined && raw.q.trim().length > 0 ? { q: raw.q.trim() } : {}),
    active,
  };
  return { query, errors };
}

/**
 * Validate + normalize the purchase-order list query. The caller renders the
 * returned errors into a `400 VALIDATION_FAILED`.
 */
export function parsePurchaseOrderListQuery(raw: RawPurchaseOrderListQuery): {
  query?: ParsedPurchaseOrderListQuery;
  errors: FieldError[];
} {
  const errors: FieldError[] = [];

  const { sort, error: sortError } = parseSort(raw.sort, PURCHASE_ORDER_SORTS, "-createdAt");
  if (sortError !== undefined) errors.push(sortError);

  if (raw.status !== undefined && !PURCHASE_ORDER_STATUSES.includes(raw.status as never)) {
    errors.push({
      field: "status",
      messages: [`status must be one of: ${PURCHASE_ORDER_STATUSES.join(", ")}`],
    });
  }

  checkUuid("supplierId", raw.supplierId, errors);
  checkDate("dateFrom", raw.dateFrom, errors);
  checkDate("dateTo", raw.dateTo, errors);

  if (errors.length > 0 || sort === undefined) return { errors };

  const query: ParsedPurchaseOrderListQuery = {
    ...(raw.limit !== undefined ? { limit: Number(raw.limit) } : {}),
    ...(raw.cursor !== undefined ? { cursor: raw.cursor } : {}),
    sort,
    ...(raw.status !== undefined ? { status: raw.status as PurchaseOrderStatus } : {}),
    ...(raw.supplierId !== undefined ? { supplierId: raw.supplierId } : {}),
    ...(raw.dateFrom !== undefined ? { dateFrom: raw.dateFrom } : {}),
    ...(raw.dateTo !== undefined ? { dateTo: raw.dateTo } : {}),
  };
  return { query, errors };
}

/**
 * Validate + normalize the expense list query. The caller renders the
 * returned errors into a `400 VALIDATION_FAILED`.
 */
export function parseExpenseListQuery(raw: RawExpenseListQuery): {
  query?: ParsedExpenseListQuery;
  errors: FieldError[];
} {
  const errors: FieldError[] = [];

  const { sort, error: sortError } = parseSort(raw.sort, EXPENSE_SORTS, "-incurredAt");
  if (sortError !== undefined) errors.push(sortError);

  checkUuid("supplierId", raw.supplierId, errors);
  checkDate("dateFrom", raw.dateFrom, errors);
  checkDate("dateTo", raw.dateTo, errors);

  if (errors.length > 0 || sort === undefined) return { errors };

  const query: ParsedExpenseListQuery = {
    ...(raw.limit !== undefined ? { limit: Number(raw.limit) } : {}),
    ...(raw.cursor !== undefined ? { cursor: raw.cursor } : {}),
    sort,
    ...(raw.category !== undefined && raw.category.trim().length > 0
      ? { category: raw.category.trim() }
      : {}),
    ...(raw.supplierId !== undefined ? { supplierId: raw.supplierId } : {}),
    ...(raw.dateFrom !== undefined ? { dateFrom: raw.dateFrom } : {}),
    ...(raw.dateTo !== undefined ? { dateTo: raw.dateTo } : {}),
  };
  return { query, errors };
}

/**
 * Validate + normalize the invoice list query. The caller renders the
 * returned errors into a `400 VALIDATION_FAILED`.
 */
export function parseInvoiceListQuery(raw: RawInvoiceListQuery): {
  query?: ParsedInvoiceListQuery;
  errors: FieldError[];
} {
  const errors: FieldError[] = [];

  const { sort, error: sortError } = parseSort(undefined, INVOICE_SORTS, "-createdAt");
  if (sortError !== undefined) errors.push(sortError);

  checkUuid("orderId", raw.orderId, errors);
  checkDate("dateFrom", raw.dateFrom, errors);
  checkDate("dateTo", raw.dateTo, errors);

  if (errors.length > 0 || sort === undefined) return { errors };

  const query: ParsedInvoiceListQuery = {
    ...(raw.limit !== undefined ? { limit: Number(raw.limit) } : {}),
    ...(raw.cursor !== undefined ? { cursor: raw.cursor } : {}),
    sort,
    ...(raw.orderId !== undefined ? { orderId: raw.orderId } : {}),
    ...(raw.dateFrom !== undefined ? { dateFrom: raw.dateFrom } : {}),
    ...(raw.dateTo !== undefined ? { dateTo: raw.dateTo } : {}),
  };
  return { query, errors };
}

/**
 * Validate + normalize the refund list query. The caller renders the
 * returned errors into a `400 VALIDATION_FAILED`.
 */
export function parseRefundListQuery(raw: RawRefundListQuery): {
  query?: ParsedRefundListQuery;
  errors: FieldError[];
} {
  const errors: FieldError[] = [];

  const { sort, error: sortError } = parseSort(undefined, REFUND_SORTS, "-createdAt");
  if (sortError !== undefined) errors.push(sortError);

  checkUuid("invoiceId", raw.invoiceId, errors);
  checkUuid("orderId", raw.orderId, errors);
  checkDate("dateFrom", raw.dateFrom, errors);
  checkDate("dateTo", raw.dateTo, errors);

  if (errors.length > 0 || sort === undefined) return { errors };

  const query: ParsedRefundListQuery = {
    ...(raw.limit !== undefined ? { limit: Number(raw.limit) } : {}),
    ...(raw.cursor !== undefined ? { cursor: raw.cursor } : {}),
    sort,
    ...(raw.invoiceId !== undefined ? { invoiceId: raw.invoiceId } : {}),
    ...(raw.orderId !== undefined ? { orderId: raw.orderId } : {}),
    ...(raw.dateFrom !== undefined ? { dateFrom: raw.dateFrom } : {}),
    ...(raw.dateTo !== undefined ? { dateTo: raw.dateTo } : {}),
  };
  return { query, errors };
}

/**
 * Validate + normalize the reconciliation list query. The caller renders the
 * returned errors into a `400 VALIDATION_FAILED`.
 */
export function parseReconciliationListQuery(raw: RawReconciliationListQuery): {
  query?: ParsedReconciliationListQuery;
  errors: FieldError[];
} {
  const errors: FieldError[] = [];

  const { sort, error: sortError } = parseSort(undefined, RECONCILIATION_SORTS, "-createdAt");
  if (sortError !== undefined) errors.push(sortError);

  if (raw.periodKey !== undefined && !PERIOD_KEY_RE.test(raw.periodKey)) {
    errors.push({ field: "periodKey", messages: ["periodKey must be formatted YYYY-MM"] });
  }

  if (errors.length > 0 || sort === undefined) return { errors };

  const query: ParsedReconciliationListQuery = {
    ...(raw.limit !== undefined ? { limit: Number(raw.limit) } : {}),
    ...(raw.cursor !== undefined ? { cursor: raw.cursor } : {}),
    sort,
    ...(raw.carrier !== undefined && raw.carrier.trim().length > 0
      ? { carrier: raw.carrier.trim() }
      : {}),
    ...(raw.periodKey !== undefined ? { periodKey: raw.periodKey } : {}),
  };
  return { query, errors };
}

/**
 * Validate + normalize a report date range (`dateFrom`/`dateTo` required,
 * `compareFrom`/`compareTo` optional but paired). The caller renders the
 * returned errors into a `400 VALIDATION_FAILED`.
 */
export function parseReportRangeQuery(raw: RawReportRangeQuery): {
  query?: ParsedReportRangeQuery;
  errors: FieldError[];
} {
  const errors: FieldError[] = [];

  if (raw.dateFrom === undefined) {
    errors.push({ field: "dateFrom", messages: ["dateFrom is required"] });
  } else {
    checkDate("dateFrom", raw.dateFrom, errors);
  }
  if (raw.dateTo === undefined) {
    errors.push({ field: "dateTo", messages: ["dateTo is required"] });
  } else {
    checkDate("dateTo", raw.dateTo, errors);
  }
  checkDate("compareFrom", raw.compareFrom, errors);
  checkDate("compareTo", raw.compareTo, errors);

  const hasCompareFrom = raw.compareFrom !== undefined;
  const hasCompareTo = raw.compareTo !== undefined;
  if (hasCompareFrom !== hasCompareTo) {
    errors.push({
      field: "compareFrom",
      messages: ["compareFrom and compareTo must be provided together"],
    });
  }

  if (errors.length > 0 || raw.dateFrom === undefined || raw.dateTo === undefined) {
    return { errors };
  }

  const query: ParsedReportRangeQuery = {
    dateFrom: raw.dateFrom,
    dateTo: raw.dateTo,
    ...(raw.compareFrom !== undefined ? { compareFrom: raw.compareFrom } : {}),
    ...(raw.compareTo !== undefined ? { compareTo: raw.compareTo } : {}),
  };
  return { query, errors };
}
