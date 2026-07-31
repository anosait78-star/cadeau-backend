/**
 * List-query parsing for `GET /v1/orders` (EPIC-11). Validates and normalizes
 * the raw query string into a shape the repository can execute, rejecting bad
 * sort/filter values per api-conventions §6/§7.
 *
 * `q` search: an all-digits term is an exact **order-number** lookup; anything
 * else is a case-insensitive `contains` over the customer **name**. Searching
 * orders by customer phone is done through the `customerId` filter — the caller
 * resolves the customer (whose phone is a blind index owned by the customers
 * module) first, which keeps the sensitive-field logic in one module and avoids
 * a cross-feature import (docs/epic-11-design.md §2, `no-cross-feature-imports`).
 */

import {
  FOLLOW_UP_STATES,
  ORDER_STATUSES,
  type FollowUpState,
  type OrderStatus,
} from "./order-status";

/** A single field error, matching api-conventions §4 (`{ field, messages }`). */
export interface FieldError {
  readonly field: string;
  readonly messages: readonly string[];
}

/** Sortable fields (whitelist). `createdAt` is the default (descending). */
export type OrderSortField = "createdAt" | "updatedAt";

/** Raw query params as they arrive (all strings). */
export interface RawOrderListQuery {
  readonly limit?: string;
  readonly cursor?: string;
  readonly sort?: string;
  readonly q?: string;
  readonly status?: string;
  readonly followUpState?: string;
  readonly assigneeId?: string;
  readonly customerId?: string;
  readonly labelId?: string;
  readonly reasonId?: string;
  readonly governorateId?: string;
  readonly createdAtFrom?: string;
  readonly createdAtTo?: string;
}

/** How `q` should be executed. */
export type OrderSearch =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "text"; readonly term: string };

/** A normalized, validated list query. */
export interface ParsedOrderListQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly sort: { readonly field: OrderSortField; readonly dir: "asc" | "desc" };
  readonly search?: OrderSearch;
  readonly status?: OrderStatus;
  readonly followUpState?: FollowUpState;
  readonly assigneeId?: string;
  readonly customerId?: string;
  readonly labelId?: string;
  readonly reasonId?: string;
  readonly governorateId?: string;
  readonly createdAtFrom?: string;
  readonly createdAtTo?: string;
}

const SORT_WHITELIST: readonly OrderSortField[] = ["createdAt", "updatedAt"];
const DEFAULT_SORT = "-createdAt";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseSort(raw: string | undefined): {
  sort?: ParsedOrderListQuery["sort"];
  error?: FieldError;
} {
  const value = raw ?? DEFAULT_SORT;
  const dir: "asc" | "desc" = value.startsWith("-") ? "desc" : "asc";
  const field = value.replace(/^-/, "");
  if (!SORT_WHITELIST.includes(field as OrderSortField)) {
    return {
      error: {
        field: "sort",
        messages: [`sort must be one of: ${SORT_WHITELIST.join(", ")} (optionally -prefixed)`],
      },
    };
  }
  return { sort: { field: field as OrderSortField, dir } };
}

function parseEnum<T extends string>(
  raw: string | undefined,
  field: string,
  allowed: readonly T[],
): { value?: T; error?: FieldError } {
  if (raw === undefined) return {};
  if (!(allowed as readonly string[]).includes(raw)) {
    return { error: { field, messages: [`${field} must be one of: ${allowed.join(", ")}`] } };
  }
  return { value: raw as T };
}

function parseUuid(raw: string | undefined, field: string): { value?: string; error?: FieldError } {
  if (raw === undefined) return {};
  if (!UUID_RE.test(raw)) return { error: { field, messages: [`${field} must be a uuid`] } };
  return { value: raw };
}

function parseDate(raw: string | undefined, field: string): { value?: string; error?: FieldError } {
  if (raw === undefined) return {};
  if (Number.isNaN(Date.parse(raw))) {
    return { error: { field, messages: [`${field} must be an ISO-8601 date-time`] } };
  }
  return { value: new Date(raw).toISOString() };
}

function parseSearch(raw: string | undefined): OrderSearch | undefined {
  if (raw === undefined) return undefined;
  const term = raw.trim();
  if (term.length === 0) return undefined;
  if (/^\d{1,18}$/.test(term)) return { kind: "number", value: Number(term) };
  return { kind: "text", term };
}

/** Validate + normalize the order list query. */
export function parseOrderListQuery(raw: RawOrderListQuery): {
  query?: ParsedOrderListQuery;
  errors: FieldError[];
} {
  const errors: FieldError[] = [];

  const { sort, error: sortError } = parseSort(raw.sort);
  if (sortError !== undefined) errors.push(sortError);

  const status = parseEnum(raw.status, "status", ORDER_STATUSES);
  if (status.error !== undefined) errors.push(status.error);
  const followUp = parseEnum(raw.followUpState, "followUpState", FOLLOW_UP_STATES);
  if (followUp.error !== undefined) errors.push(followUp.error);

  const assignee = parseUuid(raw.assigneeId, "assigneeId");
  if (assignee.error !== undefined) errors.push(assignee.error);
  const customer = parseUuid(raw.customerId, "customerId");
  if (customer.error !== undefined) errors.push(customer.error);
  const label = parseUuid(raw.labelId, "labelId");
  if (label.error !== undefined) errors.push(label.error);
  const reason = parseUuid(raw.reasonId, "reasonId");
  if (reason.error !== undefined) errors.push(reason.error);
  const governorate = parseUuid(raw.governorateId, "governorateId");
  if (governorate.error !== undefined) errors.push(governorate.error);

  const from = parseDate(raw.createdAtFrom, "createdAtFrom");
  if (from.error !== undefined) errors.push(from.error);
  const to = parseDate(raw.createdAtTo, "createdAtTo");
  if (to.error !== undefined) errors.push(to.error);

  if (errors.length > 0 || sort === undefined) return { errors };

  const search = parseSearch(raw.q);
  const query: ParsedOrderListQuery = {
    ...(raw.limit !== undefined ? { limit: Number(raw.limit) } : {}),
    ...(raw.cursor !== undefined ? { cursor: raw.cursor } : {}),
    sort,
    ...(search !== undefined ? { search } : {}),
    ...(status.value !== undefined ? { status: status.value } : {}),
    ...(followUp.value !== undefined ? { followUpState: followUp.value } : {}),
    ...(assignee.value !== undefined ? { assigneeId: assignee.value } : {}),
    ...(customer.value !== undefined ? { customerId: customer.value } : {}),
    ...(label.value !== undefined ? { labelId: label.value } : {}),
    ...(reason.value !== undefined ? { reasonId: reason.value } : {}),
    ...(governorate.value !== undefined ? { governorateId: governorate.value } : {}),
    ...(from.value !== undefined ? { createdAtFrom: from.value } : {}),
    ...(to.value !== undefined ? { createdAtTo: to.value } : {}),
  };
  return { query, errors };
}
