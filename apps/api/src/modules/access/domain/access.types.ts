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
