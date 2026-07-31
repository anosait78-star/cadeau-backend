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
