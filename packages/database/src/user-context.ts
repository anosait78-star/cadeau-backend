import { InvalidUserIdError } from "./errors";
import type { SqlExecutor } from "./types";

/** The transaction-local GUC that carries the authenticated principal for RLS. */
export const USER_GUC = "app.user_id";

/** RFC-4122 shaped UUID (8-4-4-4-12 hex). Postgres re-validates on `::uuid`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is a syntactically valid user (principal) UUID. */
export function isUserId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Assert `value` is a user UUID or throw {@link InvalidUserIdError}. */
export function assertUserId(value: unknown): asserts value is string {
  if (!isUserId(value)) {
    throw new InvalidUserIdError(value);
  }
}

/**
 * Bind the authenticated principal for the current transaction — the user-scoped
 * twin of {@link setTenantContext}. Issues
 * `set_config('app.user_id', $userId, true)`; the `true` makes it
 * transaction-LOCAL, so it is discarded at commit/rollback and cannot leak
 * across pooled connections. The value is passed as a bound parameter (never
 * interpolated) and validated first as defence in depth. RLS policies on
 * user-owned tables (profiles, sessions) read it back via `app.current_user_id()`.
 *
 * Must be called inside a transaction.
 */
export async function setUserContext(tx: SqlExecutor, userId: string): Promise<void> {
  assertUserId(userId);
  await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
}
