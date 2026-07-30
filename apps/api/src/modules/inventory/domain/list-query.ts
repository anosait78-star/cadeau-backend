/**
 * List-query parsing for `GET /v1/warehouses` and `GET /v1/inventory/stock`
 * (EPIC-9). Validates and normalizes the raw query string into a shape the
 * repository can execute, rejecting bad sort/filter values per api-conventions
 * §6/§7. Mirrors the EPIC-8 products parser.
 */

/** A single field error, matching api-conventions §4 (`{ field, messages }`). */
export interface FieldError {
  readonly field: string;
  readonly messages: readonly string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- Warehouses ------------------------------------------------------------

/** Sortable warehouse fields (whitelist). `createdAt` is the default (descending). */
export type WarehouseSortField = "name" | "createdAt";

/** Raw warehouse query params as they arrive (all strings). */
export interface RawWarehouseListQuery {
  readonly limit?: string;
  readonly cursor?: string;
  readonly sort?: string;
  readonly q?: string;
  readonly active?: string;
}

/** A normalized, validated warehouse list query. */
export interface ParsedWarehouseListQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly sort: { readonly field: WarehouseSortField; readonly dir: "asc" | "desc" };
  readonly q?: string;
  /** `true` = active only, `false` = archived only, `"all"` = no filter. */
  readonly active: boolean | "all";
}

const WAREHOUSE_SORTS: readonly WarehouseSortField[] = ["name", "createdAt"];

// ---- Stock levels ----------------------------------------------------------

/** Sortable stock fields (whitelist). `updatedAt` is the default (descending). */
export type StockSortField = "available" | "updatedAt";

/** Raw stock query params as they arrive (all strings). */
export interface RawStockListQuery {
  readonly limit?: string;
  readonly cursor?: string;
  readonly sort?: string;
  readonly warehouseId?: string;
  readonly variantId?: string;
  readonly belowReorder?: string;
}

/** A normalized, validated stock list query. */
export interface ParsedStockListQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly sort: { readonly field: StockSortField; readonly dir: "asc" | "desc" };
  readonly warehouseId?: string;
  readonly variantId?: string;
  /** When true, only levels at or below their reorder point. */
  readonly belowReorder: boolean;
}

const STOCK_SORTS: readonly StockSortField[] = ["available", "updatedAt"];

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

/** Parse a strict boolean flag; absent means `false`. */
function parseFlag(
  field: string,
  raw: string | undefined,
): { value?: boolean; error?: FieldError } {
  if (raw === undefined) return { value: false };
  if (raw === "true") return { value: true };
  if (raw === "false") return { value: false };
  return { error: { field, messages: [`${field} must be true or false`] } };
}

/** Validate an optional uuid filter, pushing a field error when malformed. */
function checkUuid(field: string, raw: string | undefined, errors: FieldError[]): void {
  if (raw !== undefined && !UUID_RE.test(raw)) {
    errors.push({ field, messages: [`${field} must be a uuid`] });
  }
}

/**
 * Validate + normalize the warehouse list query. The caller renders the returned
 * errors into a `400 VALIDATION_FAILED`.
 */
export function parseWarehouseListQuery(raw: RawWarehouseListQuery): {
  query?: ParsedWarehouseListQuery;
  errors: FieldError[];
} {
  const errors: FieldError[] = [];

  const { sort, error: sortError } = parseSort(raw.sort, WAREHOUSE_SORTS, "-createdAt");
  if (sortError !== undefined) errors.push(sortError);

  const { active, error: activeError } = parseActive(raw.active);
  if (activeError !== undefined) errors.push(activeError);

  if (errors.length > 0 || sort === undefined || active === undefined) return { errors };

  const query: ParsedWarehouseListQuery = {
    ...(raw.limit !== undefined ? { limit: Number(raw.limit) } : {}),
    ...(raw.cursor !== undefined ? { cursor: raw.cursor } : {}),
    sort,
    ...(raw.q !== undefined && raw.q.trim().length > 0 ? { q: raw.q.trim() } : {}),
    active,
  };
  return { query, errors };
}

/**
 * Validate + normalize the stock list query. The caller renders the returned
 * errors into a `400 VALIDATION_FAILED`.
 */
export function parseStockListQuery(raw: RawStockListQuery): {
  query?: ParsedStockListQuery;
  errors: FieldError[];
} {
  const errors: FieldError[] = [];

  const { sort, error: sortError } = parseSort(raw.sort, STOCK_SORTS, "-updatedAt");
  if (sortError !== undefined) errors.push(sortError);

  const { value: belowReorder, error: flagError } = parseFlag("belowReorder", raw.belowReorder);
  if (flagError !== undefined) errors.push(flagError);

  checkUuid("warehouseId", raw.warehouseId, errors);
  checkUuid("variantId", raw.variantId, errors);

  if (errors.length > 0 || sort === undefined || belowReorder === undefined) return { errors };

  const query: ParsedStockListQuery = {
    ...(raw.limit !== undefined ? { limit: Number(raw.limit) } : {}),
    ...(raw.cursor !== undefined ? { cursor: raw.cursor } : {}),
    sort,
    ...(raw.warehouseId !== undefined ? { warehouseId: raw.warehouseId } : {}),
    ...(raw.variantId !== undefined ? { variantId: raw.variantId } : {}),
    belowReorder,
  };
  return { query, errors };
}
