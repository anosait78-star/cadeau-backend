import type { AccessData } from "./capabilities";

/**
 * Read port for the access resolver: loads the raw {@link AccessData} for a
 * (user, company) pair. The Prisma-backed adapter lives in
 * {@link AccessRepository} (infrastructure); reads bind the tenant so RLS scopes
 * the tenant tables, while the system catalog is readable by all.
 */
export interface AccessRepositoryPort {
  /** Load every access fact needed to resolve one member's capabilities. */
  loadAccessData(userId: string, companyId: string): Promise<AccessData>;

  /**
   * Load the same facts for every active member of a company at once: the
   * company-wide half (plan, flags, add-ons, edges) is read a single time and
   * shared, only the role/override half differs per member.
   */
  loadCompanyMembersAccessData(companyId: string): Promise<MemberAccessData[]>;
}

/** One active member's {@link AccessData}, keyed by the membership id. */
export interface MemberAccessData {
  readonly memberId: string;
  /**
   * The member's user/profile id. Carried alongside the membership id because a
   * caller that *targets a person* (notification recipients) needs the profile
   * id, while a caller that *administers a membership* needs `memberId`.
   */
  readonly userId: string;
  readonly data: AccessData;
}

/** DI token for {@link AccessRepositoryPort}. */
export const ACCESS_REPOSITORY = Symbol("ACCESS_REPOSITORY");

/**
 * Read port for the platform Super-Admin check. Isolated from tenant-role logic:
 * it consults only the `platform_admins` grant table.
 */
export interface PlatformAdminRepositoryPort {
  /** Whether the user holds the platform Super-Admin grant. */
  isPlatformAdmin(userId: string): Promise<boolean>;
}

/** DI token for {@link PlatformAdminRepositoryPort}. */
export const PLATFORM_ADMIN_REPOSITORY = Symbol("PLATFORM_ADMIN_REPOSITORY");
