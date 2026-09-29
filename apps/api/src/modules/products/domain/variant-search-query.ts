/**
 * List-query parsing for `GET /v1/products/variants` — the flattened,
 * searchable variant list the order form picks from.
 *
 * The form used to build this list itself: read every page of products, then
 * one request per product for its variants. A few hundred products meant a few
 * hundred requests, which on a phone took long enough that searching found
 * only the part of the catalogue that had arrived. This endpoint answers the
 * same question in one request, so the client searches the catalogue instead
 * of downloading it.
 */

/** A single field error, matching api-conventions §4 (`{ field, messages }`). */
export interface FieldError {
  readonly field: string;
  readonly messages: readonly string[];
}

/** Raw query params as they arrive (all strings). */
export interface RawVariantSearchQuery {
  readonly limit?: string;
  readonly cursor?: string;
  readonly q?: string;
  readonly warehouseId?: string;
  readonly hasStock?: string;
}

/** A normalized, validated variant-search query. */
export interface ParsedVariantSearchQuery {
  readonly limit?: number;
  readonly cursor?: string;
  /** Absent when the caller wants the head of the catalogue rather than a search. */
  readonly q?: string;
  /** Only variants holding a stock row in this warehouse. */
  readonly warehouseId?: string;
  /** Only variants with units left to sell. */
  readonly hasStock: boolean;
}

/** Longest query accepted; past this it is a paste, not a search. */
export const MAX_SEARCH_LENGTH = 120;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate + normalize the variant-search query. */
export function parseVariantSearchQuery(raw: RawVariantSearchQuery): {
  query?: ParsedVariantSearchQuery;
  errors: FieldError[];
} {
  const errors: FieldError[] = [];

  if (raw.warehouseId !== undefined && !UUID_PATTERN.test(raw.warehouseId)) {
    errors.push({ field: "warehouseId", messages: ["warehouseId must be a UUID"] });
  }

  let hasStock = false;
  if (raw.hasStock !== undefined) {
    if (raw.hasStock === "true") hasStock = true;
    else if (raw.hasStock === "false") hasStock = false;
    else errors.push({ field: "hasStock", messages: ["hasStock must be true or false"] });
  }

  if (errors.length > 0) return { errors };

  // An all-whitespace query is not a search; it is an untouched box, and the
  // caller wants the head of the catalogue.
  const trimmed = (raw.q ?? "").trim().slice(0, MAX_SEARCH_LENGTH);

  const query: ParsedVariantSearchQuery = {
    ...(raw.limit !== undefined ? { limit: Number(raw.limit) } : {}),
    ...(raw.cursor !== undefined ? { cursor: raw.cursor } : {}),
    ...(trimmed.length > 0 ? { q: trimmed } : {}),
    ...(raw.warehouseId !== undefined ? { warehouseId: raw.warehouseId } : {}),
    hasStock,
  };
  return { query, errors };
}
