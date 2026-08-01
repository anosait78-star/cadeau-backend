/**
 * Shared query parsing for every `/v1/analytics/*` axis (EPIC-14, M14.2).
 * All five GET axes take the same shape: an optional `from`/`to` window
 * (defaulting to the last 30 days) and a `granularity` for the sparkline
 * bucketing. Validates and normalizes the raw query string into a shape the
 * repository can execute safely, rejecting bad values per api-conventions
 * §6/§7. Mirrors the EPIC-13 finance `list-query.ts` parser.
 */

/** A single field error, matching api-conventions §4 (`{ field, messages }`). */
export interface FieldError {
  readonly field: string;
  readonly messages: readonly string[];
}

/** Sparkline bucket size — whitelisted, never interpolated raw into SQL. */
export const GRANULARITIES = ["day", "week", "month"] as const;
export type Granularity = (typeof GRANULARITIES)[number];

const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Raw analytics window query params as they arrive (all strings). */
export interface RawAnalyticsQuery {
  readonly from?: string;
  readonly to?: string;
  readonly granularity?: string;
}

/** A normalized, validated analytics window + granularity. */
export interface ParsedAnalyticsQuery {
  readonly from: Date;
  readonly to: Date;
  readonly granularity: Granularity;
}

function checkDate(field: string, raw: string | undefined, errors: FieldError[]): void {
  if (raw !== undefined && Number.isNaN(Date.parse(raw))) {
    errors.push({ field, messages: [`${field} must be an ISO-8601 date-time`] });
  }
}

/**
 * Validate + normalize the shared analytics window query. Defaults to the
 * last 30 days when `from`/`to` are omitted (contract default). The caller
 * renders the returned errors into a `400 VALIDATION_FAILED`.
 */
export function parseAnalyticsQuery(raw: RawAnalyticsQuery): {
  query?: ParsedAnalyticsQuery;
  errors: FieldError[];
} {
  const errors: FieldError[] = [];

  checkDate("from", raw.from, errors);
  checkDate("to", raw.to, errors);

  const granularity = raw.granularity ?? "day";
  if (!GRANULARITIES.includes(granularity as Granularity)) {
    errors.push({
      field: "granularity",
      messages: [`granularity must be one of: ${GRANULARITIES.join(", ")}`],
    });
  }

  if (errors.length > 0) return { errors };

  const to = raw.to !== undefined ? new Date(raw.to) : new Date();
  const from =
    raw.from !== undefined ? new Date(raw.from) : new Date(to.getTime() - DEFAULT_WINDOW_MS);

  if (from.getTime() > to.getTime()) {
    return { errors: [{ field: "from", messages: ["from must not be after to"] }] };
  }

  return {
    query: { from, to, granularity: granularity as Granularity },
    errors: [],
  };
}

/** The previous window of equal length immediately preceding `[from, to]`. */
export function precedingWindow(from: Date, to: Date): { from: Date; to: Date } {
  const spanMs = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - spanMs), to: new Date(from.getTime()) };
}

/** The five computed analysis axes this module serves. */
export const ANALYTICS_AXES = [
  "business",
  "products",
  "inventory",
  "staff",
  "profitability",
] as const;
export type AnalyticsAxis = (typeof ANALYTICS_AXES)[number];

/** Raw export request body as it arrives. */
export interface RawExportRequest {
  readonly axis?: string;
  readonly from?: string;
  readonly to?: string;
  readonly granularity?: string;
}

/** A normalized, validated export request. */
export interface ParsedExportRequest {
  readonly axis: AnalyticsAxis;
  readonly window: ParsedAnalyticsQuery;
}

/**
 * Validate + normalize the export request body: the axis (whitelisted) plus
 * the shared window/granularity. The caller renders the returned errors into
 * a `400 VALIDATION_FAILED`.
 */
export function parseExportRequest(raw: RawExportRequest): {
  query?: ParsedExportRequest;
  errors: FieldError[];
} {
  const errors: FieldError[] = [];

  if (raw.axis === undefined || !ANALYTICS_AXES.includes(raw.axis as AnalyticsAxis)) {
    errors.push({ field: "axis", messages: [`axis must be one of: ${ANALYTICS_AXES.join(", ")}`] });
  }

  const { query: window, errors: windowErrors } = parseAnalyticsQuery(raw);
  errors.push(...windowErrors);

  if (errors.length > 0 || window === undefined) return { errors };

  return { query: { axis: raw.axis as AnalyticsAxis, window }, errors: [] };
}
