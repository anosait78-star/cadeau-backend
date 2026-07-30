/** Auth audit events (ADR-004 vocabulary). */
export type AuthAuditEvent =
  | "auth.registered"
  | "auth.logged_in"
  | "auth.login_failed"
  | "auth.token_refreshed"
  | "auth.token_reuse_detected"
  | "auth.logged_out"
  | "auth.session_revoked"
  | "auth.2fa_required"
  | "auth.2fa_failed"
  | "auth.2fa_enrolled"
  | "auth.2fa_enabled"
  | "auth.company_switched";

/** Structured, secret-free details for an audit record. */
export interface AuthAuditDetails {
  readonly userId?: string;
  readonly sessionId?: string;
  readonly familyId?: string;
  /** Present for tenant-switch events. */
  readonly companyId?: string;
  /** Present for failures where no principal is known (e.g. bad login email). */
  readonly emailAttempted?: string;
  readonly ipAddress?: string | null;
}

/**
 * Port for recording auth events. Auth happens before a tenant context exists,
 * so these events cannot go to the tenant-scoped `audit_log` (which requires a
 * `company_id`); the adapter records them through the structured logger instead.
 * Tenant-scoped audit rows arrive once a company context exists (M4.4+).
 *
 * Implementations MUST NOT record credentials, tokens, or 2FA secrets.
 */
export interface AuthAuditPort {
  record(event: AuthAuditEvent, details: AuthAuditDetails): void;
}

/** DI token for {@link AuthAuditPort}. */
export const AUTH_AUDIT = Symbol("AUTH_AUDIT");
