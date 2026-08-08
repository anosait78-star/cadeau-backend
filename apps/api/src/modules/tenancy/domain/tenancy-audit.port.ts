/** Tenancy audit events (ADR-004 vocabulary). */
export type TenancyAuditEvent =
  | "company.created"
  | "company.whatsapp_settings_updated"
  | "member.invited"
  | "member.invite_revoked"
  | "member.joined"
  | "member.removed";

/** Structured, secret-free details for a tenancy audit record. */
export interface TenancyAuditDetails {
  readonly userId?: string;
  readonly companyId?: string;
  readonly invitationId?: string;
  readonly email?: string;
  readonly role?: string;
  readonly memberId?: string;
}

/**
 * Port for recording tenancy events. Implementations MUST NOT record invite
 * codes, tokens, or other secrets. Persisted through the structured logger for
 * now (consistent with auth); durable, tenant-scoped `audit_log` rows are
 * formalized alongside the access model in EPIC-5.
 */
export interface TenancyAuditPort {
  record(event: TenancyAuditEvent, details: TenancyAuditDetails): void;
}

/** DI token for {@link TenancyAuditPort}. */
export const TENANCY_AUDIT = Symbol("TENANCY_AUDIT");
