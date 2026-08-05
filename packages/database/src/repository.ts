import { assertCompanyId } from "./tenant-context";

/**
 * Tenant-scoping repository helpers — the application-layer half of the
 * two-layer isolation model (Roadmap §1): the BFF stamps and scopes every query
 * by `company_id` here, and Postgres RLS enforces the same isolation again as a
 * second, independent line of defence. Both must agree; neither is trusted alone.
 *
 * These are the pieces domain repositories (built in their epics) compose. They
 * carry no Prisma coupling so they stay trivially unit-testable.
 */

/** The active tenant + acting member for a unit of work. */
export interface TenantActor {
  /** Tenant (company) UUID — always required. */
  readonly companyId: string;
  /** Acting member UUID, or `null` for system/unauthenticated actions (pre-Auth). */
  readonly actorId: string | null;
}

/** Merge the tenant filter into a `where`, so reads can never escape the tenant. */
export function scopedWhere<W extends object>(
  companyId: string,
  where?: W,
): W & { companyId: string } {
  assertCompanyId(companyId);
  return { ...(where ?? ({} as W)), companyId };
}

/**
 * Stamp create input with the Cadeau base columns (§16.2): the tenant and the
 * created/updated actor. `created_at`/`updated_at` are left to the database
 * defaults; the audit actor is `null` until Auth (EPIC-4) provides members.
 */
export function stampForCreate<D extends object>(
  actor: TenantActor,
  data: D,
): D & { companyId: string; createdBy: string | null; updatedBy: string | null } {
  assertCompanyId(actor.companyId);
  return {
    ...data,
    companyId: actor.companyId,
    createdBy: actor.actorId,
    updatedBy: actor.actorId,
  };
}

/**
 * Stamp update input with the acting member. `updated_at` is refreshed by the
 * `app.touch_updated_at()` trigger at the database, so it is not set here.
 */
export function stampForUpdate<D extends object>(
  actor: TenantActor,
  data: D,
): D & { updatedBy: string | null } {
  return { ...data, updatedBy: actor.actorId };
}
