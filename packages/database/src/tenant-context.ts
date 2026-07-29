import { InvalidCompanyIdError } from "./errors";
import type { SqlExecutor } from "./types";

/** The transaction-local GUC that carries the active tenant for RLS. */
export const TENANT_GUC = "app.company_id";

/** RFC-4122 shaped UUID (8-4-4-4-12 hex). Postgres re-validates on `::uuid`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is a syntactically valid tenant (company) UUID. */
export function isCompanyId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Assert `value` is a tenant UUID or throw {@link InvalidCompanyIdError}. */
export function assertCompanyId(value: unknown): asserts value is string {
  if (!isCompanyId(value)) {
    throw new InvalidCompanyIdError(value);
  }
}

/**
 * Bind the active tenant for the current transaction. Issues
 * `set_config('app.company_id', $companyId, true)` — the `true` makes it
 * transaction-LOCAL, so it is automatically discarded at commit/rollback and
 * cannot leak across pooled connections. The value is passed as a bound
 * parameter (never string-interpolated) and validated first as defence in
 * depth. Every RLS policy reads it back via `app.current_company_id()`.
 *
 * Must be called inside a transaction (see {@link withTenantTransaction}).
 */
export async function setTenantContext(tx: SqlExecutor, companyId: string): Promise<void> {
  assertCompanyId(companyId);
  await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
}
