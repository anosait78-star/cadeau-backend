import { InvalidCursorError } from "./errors";

/**
 * Keyset (cursor) pagination — the project's only list-pagination strategy
 * (Roadmap §16.3, api-conventions §5). Offset pagination is never used: it is
 * slow at depth and unstable under concurrent writes.
 *
 * The cursor is an opaque, server-issued token that encodes the last row's sort
 * keys plus a unique tie-breaker (typically `id`). Clients treat it as a
 * blackbox: they read `page.nextCursor` and pass it back as `cursor`, nothing
 * more. Callers translate the decoded values into the keyset `WHERE` predicate
 * for their table; this module owns cursor encoding, limit clamping, and the
 * page envelope.
 */

/** The decoded contents of a cursor: the sort-key values of the last row seen. */
export type CursorValues = Readonly<Record<string, string | number>>;

export interface KeysetLimitOptions {
  /** Limit used when the client sends none. */
  readonly defaultLimit?: number;
  /** Hard ceiling; larger requests are clamped down to it. */
  readonly maxLimit?: number;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** The list envelope returned to callers (mirrors api-conventions §2.2 / §5). */
export interface KeysetPage<T> {
  readonly data: readonly T[];
  readonly page: {
    readonly limit: number;
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

/**
 * Clamp a requested page size into `[1, maxLimit]`, defaulting when absent.
 * Non-integers are floored; invalid/≤0 values fall back to the default.
 */
export function clampLimit(
  requested: number | undefined,
  options: KeysetLimitOptions = {},
): number {
  const fallback = options.defaultLimit ?? DEFAULT_LIMIT;
  const ceiling = options.maxLimit ?? MAX_LIMIT;
  if (requested === undefined || !Number.isFinite(requested)) return fallback;
  const value = Math.floor(requested);
  if (value < 1) return fallback;
  return Math.min(value, ceiling);
}

/** Encode sort-key values into an opaque, url-safe cursor token. */
export function encodeCursor(values: CursorValues): string {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

/** Decode a cursor token back into its sort-key values, or throw on garbage. */
export function decodeCursor(cursor: string): CursorValues {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCursorError();
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvalidCursorError();
  }
  for (const value of Object.values(parsed)) {
    if (typeof value !== "string" && typeof value !== "number") {
      throw new InvalidCursorError();
    }
  }
  return parsed as CursorValues;
}

/**
 * Build the page envelope from rows fetched with **one extra row** (`take =
 * limit + 1`). The extra row is how we know whether more pages exist without a
 * second count query: if it came back, `hasMore` is true and `nextCursor` points
 * at the last row *within* the limit. `toCursor` extracts a row's sort keys.
 */
export function buildKeysetPage<T>(
  rows: readonly T[],
  limit: number,
  toCursor: (row: T) => CursorValues,
): KeysetPage<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows.slice();
  const last = data.at(-1);
  const nextCursor = hasMore && last !== undefined ? encodeCursor(toCursor(last)) : null;
  return { data, page: { limit, nextCursor, hasMore } };
}
