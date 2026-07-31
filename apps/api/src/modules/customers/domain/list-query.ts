/**
 * List-query parsing for `GET /v1/customers` (EPIC-10). Validates and normalizes
 * the raw query string into a shape the repository can execute, rejecting bad
 * sort/filter values per api-conventions §6/§7.
 *
 * The one thing specific to this resource is `q`. Because the phone is stored as
 * a blind index, it can be matched **exactly or not at all** — so the parser
 * decides up front which kind of search the caller asked for: if the term
 * normalizes to E.164 it becomes a phone lookup, otherwise a name/email
 * `contains` search. The repository never has to guess.
 */

import { normalizeE164 } from "./phone";

/** A single field error, matching api-conventions §4 (`{ field, messages }`). */
export interface FieldError {
  readonly field: string;
  readonly messages: readonly string[];
}

/** Sortable fields (whitelist). `createdAt` is the default (descending). */
export type CustomerSortField = "name" | "createdAt";

/** Raw query params as they arrive (all strings). */
export interface RawCustomerListQuery {
  readonly limit?: string;
  readonly cursor?: string;
  readonly sort?: string;
  readonly q?: string;
  readonly active?: string;
  readonly governorateId?: string;
  readonly createdAtFrom?: string;
  readonly createdAtTo?: string;
}

/**
 * How `q` should be executed. `phone` carries the **normalized** number — the
 * repository hashes it and matches the blind index; `text` carries a free-text
 * term for name/email.
 */
export type CustomerSearch =
  | { readonly kind: "phone"; readonly e164: string }
  | { readonly kind: "text"; readonly term: string };

/** A normalized, validated list query. */
export interface ParsedCustomerListQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly sort: { readonly field: CustomerSortField; readonly dir: "asc" | "desc" };
  readonly search?: CustomerSearch;
  /** `true` = active only, `false` = archived only, `"all"` = no filter. */
  readonly active: boolean | "all";
  /** Match customers having at least one address in this governorate. */
  readonly governorateId?: string;
  readonly createdAtFrom?: string;
  readonly createdAtTo?: string;
}

const SORT_WHITELIST: readonly CustomerSortField[] = ["name", "createdAt"];
const DEFAULT_SORT = "-createdAt";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse `?sort=` (a leading `-` means descending), defaulting to `-createdAt`. */
function parseSort(raw: string | undefined): {
  sort?: ParsedCustomerListQuery["sort"];
  error?: FieldError;
} {
  const value = raw ?? DEFAULT_SORT;
  const dir: "asc" | "desc" = value.startsWith("-") ? "desc" : "asc";
  const field = value.replace(/^-/, "");
  if (!SORT_WHITELIST.includes(field as CustomerSortField)) {
    return {
      error: {
        field: "sort",
        messages: [`sort must be one of: ${SORT_WHITELIST.join(", ")} (optionally -prefixed)`],
      },
    };
  }
  return { sort: { field: field as CustomerSortField, dir } };
}

/** Parse the `active` tri-state filter. */
function parseActive(raw: string | undefined): { active?: boolean | "all"; error?: FieldError } {
  if (raw === undefined) return { active: true };
  if (raw === "true") return { active: true };
  if (raw === "false") return { active: false };
  if (raw === "all") return { active: "all" };
  return { error: { field: "active", messages: ["active must be true, false, or all"] } };
}

/** Parse an ISO-8601 date-time bound. */
function parseDate(raw: string | undefined, field: string): { value?: string; error?: FieldError } {
  if (raw === undefined) return {};
  if (Number.isNaN(Date.parse(raw))) {
    return { error: { field, messages: [`${field} must be an ISO-8601 date-time`] } };
  }
  return { value: new Date(raw).toISOString() };
}

/**
 * Decide how `q` is executed. A term that normalizes to E.164 is an exact phone
 * lookup; anything else is a name/email search. Note there is no third option:
 * a *partial* phone cannot be matched against a blind index at all
 * (docs/privacy-model.md §5).
 */
function parseSearch(raw: string | undefined): CustomerSearch | undefined {
  if (raw === undefined) return undefined;
  const term = raw.trim();
  if (term.length === 0) return undefined;
  const e164 = normalizeE164(term);
  return e164 !== null ? { kind: "phone", e164 } : { kind: "text", term };
}

/**
 * Validate + normalize the customer list query. The caller renders the returned
 * errors into a `400 VALIDATION_FAILED`.
 */
export function parseCustomerListQuery(raw: RawCustomerListQuery): {
  query?: ParsedCustomerListQuery;
  errors: FieldError[];
} {
  const errors: FieldError[] = [];

  const { sort, error: sortError } = parseSort(raw.sort);
  if (sortError !== undefined) errors.push(sortError);

  const { active, error: activeError } = parseActive(raw.active);
  if (activeError !== undefined) errors.push(activeError);

  if (raw.governorateId !== undefined && !UUID_RE.test(raw.governorateId)) {
    errors.push({ field: "governorateId", messages: ["governorateId must be a uuid"] });
  }

  const from = parseDate(raw.createdAtFrom, "createdAtFrom");
  if (from.error !== undefined) errors.push(from.error);
  const to = parseDate(raw.createdAtTo, "createdAtTo");
  if (to.error !== undefined) errors.push(to.error);

  if (errors.length > 0 || sort === undefined || active === undefined) {
    return { errors };
  }

  const search = parseSearch(raw.q);
  const query: ParsedCustomerListQuery = {
    ...(raw.limit !== undefined ? { limit: Number(raw.limit) } : {}),
    ...(raw.cursor !== undefined ? { cursor: raw.cursor } : {}),
    sort,
    ...(search !== undefined ? { search } : {}),
    active,
    ...(raw.governorateId !== undefined ? { governorateId: raw.governorateId } : {}),
    ...(from.value !== undefined ? { createdAtFrom: from.value } : {}),
    ...(to.value !== undefined ? { createdAtTo: to.value } : {}),
  };
  return { query, errors };
}
