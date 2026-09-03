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
  readonly phone: string | null;
  readonly monthlyOrdersRange: string | null;
  readonly country: string | null;
  readonly facebookHandle: string | null;
  readonly instagramHandle: string | null;
  readonly websiteUrl: string | null;
  readonly shippingCarrier: string | null;
  /** Dialing prefix prepended to phone numbers for WhatsApp (settings tab). */
  readonly whatsappCountryCode: string | null;
  readonly createdAt: Date;
}

/** A company the caller belongs to, with their membership role/status. */
export interface MembershipCompany {
  readonly id: string;
  readonly name: string;
  readonly slug: string | null;
  readonly role: string;
  readonly status: string;
  /** Dialing prefix prepended to phone numbers for WhatsApp (settings tab). */
  readonly whatsappCountryCode: string | null;
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
  readonly role: string;
  /**
   * Permission keys for a one-off "custom" role (Team/Invitations, EPIC-15).
   * Empty for invitations issued against a fixed template key.
   */
  readonly customPermissionKeys: readonly string[];
  readonly status: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/**
 * Result of accepting an invite by code. The code alone identifies the
 * invitation — it is not scoped to an email address, so whoever holds it joins
 * with it, exactly like {@link AcceptWarehouseJoinCodeOutcome}.
 */
export type AcceptOutcome =
  | { readonly kind: "accepted"; readonly companyId: string; readonly role: string }
  | { readonly kind: "already_member"; readonly companyId: string; readonly role: string }
  | { readonly kind: "invalid" };

/**
 * Result of accepting a warehouse join code (Vendor Accounts, Phase 1). Same
 * shape as {@link AcceptOutcome}, plus the warehouse the membership is scoped
 * to.
 */
export type AcceptWarehouseJoinCodeOutcome =
  | {
      readonly kind: "accepted";
      readonly companyId: string;
      readonly role: string;
      readonly warehouseId: string;
    }
  | {
      readonly kind: "already_member";
      readonly companyId: string;
      readonly role: string;
      readonly warehouseId: string | null;
    }
  | { readonly kind: "invalid" };

/** A company member as returned by the Team members list. */
export interface MemberView {
  readonly id: string;
  readonly userId: string;
  readonly name: string | null;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly joinedAt: Date;
}

/** Result of attempting to remove a member. */
export type RemoveMemberOutcome =
  | { readonly kind: "removed" }
  | { readonly kind: "not_found" }
  | { readonly kind: "last_owner" }
  | { readonly kind: "not_owner" };
