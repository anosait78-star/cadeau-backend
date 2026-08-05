import type { KeysetPage } from "@cadeau/database";
import type {
  AdminCompanyView,
  FeatureCatalogEntry,
  MemberPermissionOverride,
  MemberPermissionsSnapshot,
  MemberRow,
  PermissionTemplateView,
} from "./access.types";

/** Input to (re)assign a member's template and/or permission overrides. */
export interface AssignMemberPermissionsInput {
  readonly companyId: string;
  readonly memberId: string;
  readonly actorId: string;
  /** New role/template key; omitted leaves the role unchanged. */
  readonly templateKey?: string;
  /** Full replacement set of per-member overrides; omitted leaves them unchanged. */
  readonly overrides?: readonly MemberPermissionOverride[];
}

/** Both snapshots of an assignment, for before/after audit. */
export interface AssignMemberPermissionsResult {
  readonly before: MemberPermissionsSnapshot;
  readonly after: MemberPermissionsSnapshot;
  readonly memberUserId: string;
}

/**
 * Persistence port for access management + the Super-Admin surface. The
 * Prisma-backed adapter lives in infrastructure. Tenant operations bind the
 * active/target company so RLS scopes them; catalog reads are unrestricted;
 * cross-tenant company listing binds the admin's user so the platform-admin RLS
 * clause applies.
 */
export interface AccessManagementRepositoryPort {
  /** The full feature catalog (system reference data). */
  listFeatureCatalog(): Promise<FeatureCatalogEntry[]>;

  /** The permission templates with their granted permission keys. */
  listPermissionTemplates(): Promise<PermissionTemplateView[]>;

  /** The template keys that exist (for validating an assignment). */
  listTemplateKeys(): Promise<string[]>;

  /** A member of the given (active) company, or null. */
  findMember(companyId: string, memberId: string): Promise<MemberRow | null>;

  /** Apply a template/override assignment atomically; returns before/after + the member's user id. */
  assignMemberPermissions(
    input: AssignMemberPermissionsInput,
  ): Promise<AssignMemberPermissionsResult>;

  /**
   * All companies (Super-Admin), keyset-paginated (createdAt/id desc). Binds
   * `adminUserId` so the platform-admin RLS clause returns every company. Throws
   * {@link InvalidCursorInputError} on a malformed cursor.
   */
  listAllCompanies(
    adminUserId: string,
    rawLimit: number | undefined,
    rawCursor: string | undefined,
  ): Promise<KeysetPage<AdminCompanyView>>;

  /** A plan by its code, or null. */
  findPlanByCode(code: string): Promise<{ id: string; code: string } | null>;

  /** Whether a feature key exists in the catalog. */
  featureExists(featureKey: string): Promise<boolean>;

  /** Upsert a company's feature flag (Super-Admin); binds the target company. */
  setCompanyFeatureFlag(input: {
    readonly companyId: string;
    readonly featureKey: string;
    readonly enabled: boolean;
    readonly actorId: string;
  }): Promise<void>;

  /** Set a company's subscription plan (Super-Admin); binds the target company. */
  setSubscription(input: {
    readonly companyId: string;
    readonly planId: string;
    readonly actorId: string;
  }): Promise<void>;
}

/** DI token for {@link AccessManagementRepositoryPort}. */
export const ACCESS_MANAGEMENT_REPOSITORY = Symbol("ACCESS_MANAGEMENT_REPOSITORY");
