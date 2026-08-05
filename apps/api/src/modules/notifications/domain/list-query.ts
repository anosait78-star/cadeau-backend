/**
 * List-query parsing for `GET /v1/notifications` (EPIC-15). Sort is fixed
 * (`-createdAt, id` — the contract defines no client-chosen sort, unlike
 * every other list endpoint), so the only work here is validating the
 * `type`/`read`/`createdAtFrom`/`createdAtTo` filters.
 */
import { isNotificationType, type NotificationType } from "./notification-types";

/** A single field error, matching api-conventions §4 (`{ field, messages }`). */
export interface FieldError {
  readonly field: string;
  readonly messages: readonly string[];
}

/** Raw query params as they arrive (all strings). */
export interface RawNotificationListQuery {
  readonly limit?: string;
  readonly cursor?: string;
  readonly type?: string;
  readonly read?: string;
  readonly createdAtFrom?: string;
  readonly createdAtTo?: string;
}

/** A normalized, validated list query. */
export interface ParsedNotificationListQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly type?: NotificationType;
  readonly read?: boolean;
  readonly createdAtFrom?: string;
  readonly createdAtTo?: string;
}

function parseDate(raw: string | undefined, field: string): { value?: string; error?: FieldError } {
  if (raw === undefined) return {};
  if (Number.isNaN(Date.parse(raw))) {
    return { error: { field, messages: [`${field} must be an ISO-8601 date-time`] } };
  }
  return { value: new Date(raw).toISOString() };
}

/** Validate + normalize the notification list query. */
export function parseNotificationListQuery(raw: RawNotificationListQuery): {
  query?: ParsedNotificationListQuery;
  errors: FieldError[];
} {
  const errors: FieldError[] = [];

  if (raw.type !== undefined && !isNotificationType(raw.type)) {
    errors.push({ field: "type", messages: ["type must be a known notification type"] });
  }

  let read: boolean | undefined;
  if (raw.read !== undefined) {
    if (raw.read === "true") read = true;
    else if (raw.read === "false") read = false;
    else errors.push({ field: "read", messages: ["read must be true or false"] });
  }

  const from = parseDate(raw.createdAtFrom, "createdAtFrom");
  if (from.error !== undefined) errors.push(from.error);
  const to = parseDate(raw.createdAtTo, "createdAtTo");
  if (to.error !== undefined) errors.push(to.error);

  if (errors.length > 0) return { errors };

  const query: ParsedNotificationListQuery = {
    ...(raw.limit !== undefined ? { limit: Number(raw.limit) } : {}),
    ...(raw.cursor !== undefined ? { cursor: raw.cursor } : {}),
    ...(raw.type !== undefined ? { type: raw.type as NotificationType } : {}),
    ...(read !== undefined ? { read } : {}),
    ...(from.value !== undefined ? { createdAtFrom: from.value } : {}),
    ...(to.value !== undefined ? { createdAtTo: to.value } : {}),
  };
  return { query, errors };
}
