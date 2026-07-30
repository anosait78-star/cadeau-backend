/**
 * Tenancy domain types — pure data shapes (no framework/IO coupling). Cover the
 * caller's profile view, the companies they belong to, tenant creation, and
 * invitations. PII is only ever decrypted at the application edge for the owner.
 */

/** A company as returned after creation. */
export interface CompanyRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string | null;
  readonly status: string;
  readonly createdAt: Date;
}

/** A company the caller belongs to, with their membership role/status. */
export interface MembershipCompany {
  readonly id: string;
  readonly name: string;
  readonly slug: string | null;
  readonly role: string;
  readonly status: string;
}

/** The caller's own profile fields for `/v1/me` (phone still encrypted here). */
export interface MeProfileRow {
  readonly id: string;
  readonly email: string;
  readonly fullName: string | null;
  readonly phoneEncrypted: string | null;
  readonly totpEnabledAt: Date | null;
}

/** The assembled `/v1/me` view the service returns. */
export interface MeView {
  readonly id: string;
  readonly email: string;
  readonly fullName: string | null;
  /** Decrypted for the owner only; null when unset. */
  readonly phone: string | null;
  readonly twoFactorEnabled: boolean;
  readonly activeCompanyId: string | null;
  readonly companies: readonly MembershipCompany[];
}

/** An invitation as stored/returned (never carries the plaintext code). */
export interface InvitationRecord {
  readonly id: string;
  readonly companyId: string;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/** Result of accepting an invite by code. */
export type AcceptOutcome =
  | { readonly kind: "accepted"; readonly companyId: string; readonly role: string }
  | { readonly kind: "already_member"; readonly companyId: string; readonly role: string }
  | { readonly kind: "invalid" }
  | { readonly kind: "email_mismatch" };
