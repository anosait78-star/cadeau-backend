import { assertCompanyId, setTenantContext } from "./tenant-context";
import type { SqlExecutor, TransactionRunner } from "./types";

/**
 * Run `fn` inside a database transaction with no tenant bound. Reserved for
 * platform-level (Super Admin) work that legitimately operates across tenants;
 * tenant-scoped work must use {@link withTenantTransaction} so RLS applies.
 */
export function withTransaction<T>(
  client: TransactionRunner,
  fn: (tx: SqlExecutor) => Promise<T>,
): Promise<T> {
  return client.$transaction(fn);
}

/**
 * Run `fn` inside a transaction with the tenant RLS context bound for its whole
 * duration. The company id is validated, then set as the transaction-local
 * `app.company_id` GUC before `fn` runs, so every statement `fn` issues is
 * automatically scoped to that tenant by RLS. The context is discarded when the
 * transaction ends.
 */
export async function withTenantTransaction<T>(
  client: TransactionRunner,
  companyId: string,
  fn: (tx: SqlExecutor) => Promise<T>,
): Promise<T> {
  assertCompanyId(companyId);
  return client.$transaction(async (tx) => {
    await setTenantContext(tx, companyId);
    return fn(tx);
  });
}
