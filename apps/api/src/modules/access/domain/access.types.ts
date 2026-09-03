/** Domain view/DTO-source types for the access module (EPIC-5). */

/** A feature in the catalog, annotated with whether it is enabled for a company. */
export interface FeatureView {
  readonly key: string;
  readonly name: string;
  readonly category: string;
  readonly enabled: boolean;
}

/** A permission template (role preset) and the permission keys it grants. */
export interface PermissionTemplateView {
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly permissions: readonly string[];
}

/**
 * One permission from the catalog, carrying whether the caller's company can
 * actually grant it right now — `available` is the three-layer resolution
 * (plan ∪ add-ons, flags applied, ∩ globally-active), independent of any one
 * member's role. `featureKey` is `null` for the two feature-independent core
 * permissions (`access.read`, `access.manage`).
 *
 * The **whole** catalog is returned, not just the grantable part: the
 * custom-role picker shows an out-of-plan permission disabled rather than
 * hiding it, so an admin can see what the company does not have instead of
 * wondering whether the list is complete. `POST .../invitations` still
 * re-validates every chosen key server-side against the same resolution — an
 * unavailable key sent anyway is rejected there, so listing it is not a grant.
 */
export interface AvailablePermissionView {
  readonly key: string;
  readonly description: string | null;
  readonly featureKey: string | null;
  /** Whether the company's plan/features currently make this permission grantable. */
  readonly available: boolean;
}

/** The caller's effective capabilities plus their platform/tenant context. */
export interface CapabilitiesView {
  readonly features: readonly string[];
  readonly permissions: readonly string[];
  readonly isSuperAdmin: boolean;
  readonly activeCompanyId: string | null;
}

/** A per-member permission override to apply. */
export interface MemberPermissionOverride {
  readonly key: string;
  readonly granted: boolean;
}

/** A company row for the Super-Admin surface. */
export interface AdminCompanyView {
  readonly id: string;
  readonly name: string;
  readonly slug: string | null;
  readonly status: string;
  readonly planCode: string | null;
  readonly createdAt: Date;
}

/** A catalog feature as stored (before per-company annotation). */
export interface FeatureCatalogEntry {
  readonly key: string;
  readonly name: string;
  readonly category: string;
  readonly isActive: boolean;
}

/** A company membership row the management flow needs. */
export interface MemberRow {
  readonly id: string;
  readonly userId: string;
  readonly role: string;
}

/** A snapshot of a member's permission state, for before/after audit. */
export interface MemberPermissionsSnapshot {
  readonly role: string;
  readonly overrides: readonly MemberPermissionOverride[];
}
