/**
 * List-query parsing for `GET /v1/products` (EPIC-8). Validates and normalizes
 * the raw query string into a shape the repository can execute, rejecting bad
 * sort/filter values per api-conventions §6/§7. Mirrors the master-data engine's
 * approach but is specific to the product resource.
 */

/** A single field error, matching api-conventions §4 (`{ field, messages }`). */
export interface FieldError {
  readonly field: string;
  readonly messages: readonly string[];
}

/** Sortable fields (whitelist). `createdAt` is the default (descending). */
export type ProductSortField = "name" | "createdAt";

/** Raw query params as they arrive (all strings). */
export interface RawProductListQuery {
  readonly limit?: string;
  readonly cursor?: string;
  readonly sort?: string;
  readonly q?: string;
  readonly active?: string;
  readonly categoryId?: string;
  readonly hasStock?: string;
}

/** A normalized, validated list query. */
export interface ParsedProductListQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly sort: { readonly field: ProductSortField; readonly dir: "asc" | "desc" };
  readonly q?: string;
  /** `true` = active only, `false` = archived only, `"all"` = no filter. */
  readonly active: boolean | "all";
  readonly categoryId?: string;
  /** When true, only products with at least one variant holding available stock (EPIC-9). */
  readonly hasStock: boolean;
}

const SORT_WHITELIST: readonly ProductSortField[] = ["name", "createdAt"];
const DEFAULT_SORT = "-createdAt";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse `?sort=` (a leading `-` means descending), defaulting to `-createdAt`. */
function parseSort(raw: string | undefined): {
  sort?: ParsedProductListQuery["sort"];
  error?: FieldError;
} {
  const value = raw ?? DEFAULT_SORT;
  const dir: "asc" | "desc" = value.startsWith("-") ? "desc" : "asc";
  const field = value.replace(/^-/, "");
  if (!SORT_WHITELIST.includes(field as ProductSortField)) {
    return {
      error: {
        field: "sort",
        messages: [`sort must be one of: ${SORT_WHITELIST.join(", ")} (optionally -prefixed)`],
      },
    };
  }
  return { sort: { field: field as ProductSortField, dir } };
}

/** Parse the `active` tri-state filter. */
function parseActive(raw: string | undefined): { active?: boolean | "all"; error?: FieldError } {
  if (raw === undefined) return { active: true };
  if (raw === "true") return { active: true };
  if (raw === "false") return { active: false };
  if (raw === "all") return { active: "all" };
  return { error: { field: "active", messages: ["active must be true, false, or all"] } };
}

/**
 * Validate + normalize the product list query. The caller renders the returned
 * errors into a `400 VALIDATION_FAILED`.
 */
export function parseProductListQuery(raw: RawProductListQuery): {
  query?: ParsedProductListQuery;
  errors: FieldError[];
} {
  const errors: FieldError[] = [];

  const { sort, error: sortError } = parseSort(raw.sort);
  if (sortError !== undefined) errors.push(sortError);

  const { active, error: activeError } = parseActive(raw.active);
  if (activeError !== undefined) errors.push(activeError);

  if (raw.categoryId !== undefined && !UUID_RE.test(raw.categoryId)) {
    errors.push({ field: "categoryId", messages: ["categoryId must be a uuid"] });
  }

  let hasStock = false;
  if (raw.hasStock === "true") hasStock = true;
  else if (raw.hasStock !== undefined && raw.hasStock !== "false") {
    errors.push({ field: "hasStock", messages: ["hasStock must be true or false"] });
  }

  if (errors.length > 0 || sort === undefined || active === undefined) {
    return { errors };
  }

  const query: ParsedProductListQuery = {
    ...(raw.limit !== undefined ? { limit: Number(raw.limit) } : {}),
    ...(raw.cursor !== undefined ? { cursor: raw.cursor } : {}),
    sort,
    ...(raw.q !== undefined && raw.q.trim().length > 0 ? { q: raw.q.trim() } : {}),
    active,
    ...(raw.categoryId !== undefined ? { categoryId: raw.categoryId } : {}),
    hasStock,
  };
  return { query, errors };
}
