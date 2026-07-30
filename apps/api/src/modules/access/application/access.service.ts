import { Inject, Injectable } from "@nestjs/common";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppErrors } from "../../../shared/errors/app-exception";
import { AccessResolverService } from "../../../shared/access/access-resolver.service";
import { CapabilityCache } from "../../../shared/access/capability-cache";
import {
  PLATFORM_ADMIN_REPOSITORY,
  type PlatformAdminRepositoryPort,
} from "../../../shared/access/access-repository.port";
import { ACCESS_AUDIT, type AccessAuditPort } from "../domain/access-audit.port";
import {
  ACCESS_MANAGEMENT_REPOSITORY,
  type AccessManagementRepositoryPort,
} from "../domain/access-management.port";
import type {
  CapabilitiesView,
  FeatureView,
  MemberPermissionOverride,
  MemberPermissionsSnapshot,
  PermissionTemplateView,
} from "../domain/access.types";

/** What the caller may change on a member. Both parts optional; at least one required. */
export interface AssignMemberInput {
  readonly templateKey?: string;
  readonly overrides?: readonly MemberPermissionOverride[];
}

/**
 * Orchestrates the caller-facing access surface: reading effective capabilities
 * (delegating the triple-layer resolution to the shared {@link AccessResolverService}),
 * listing the company's features and the permission templates, and assigning a
 * member's template/overrides. Every mutation is audited and invalidates the
 * capability cache so the next request re-resolves.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly resolver: AccessResolverService,
    @Inject(PLATFORM_ADMIN_REPOSITORY)
    private readonly platformAdmins: PlatformAdminRepositoryPort,
    @Inject(ACCESS_MANAGEMENT_REPOSITORY)
    private readonly repo: AccessManagementRepositoryPort,
    @Inject(ACCESS_AUDIT) private readonly audit: AccessAuditPort,
    private readonly cache: CapabilityCache,
  ) {}

  /** The caller's effective capabilities plus their platform/tenant context. */
  async getCapabilities(principal: RequestPrincipal): Promise<CapabilitiesView> {
    const [caps, isSuperAdmin] = await Promise.all([
      this.resolver.resolve(principal),
      this.platformAdmins.isPlatformAdmin(principal.userId),
    ]);
    return {
      features: caps.features,
      permissions: caps.permissions,
      isSuperAdmin,
      activeCompanyId: principal.companyId,
    };
  }

  /** The full feature catalog annotated with whether each is enabled for the company. */
  async listFeatures(principal: RequestPrincipal): Promise<FeatureView[]> {
    const [caps, catalog] = await Promise.all([
      this.resolver.resolve(principal),
      this.repo.listFeatureCatalog(),
    ]);
    const enabled = new Set(caps.features);
    return catalog.map((f) => ({
      key: f.key,
      name: f.name,
      category: f.category,
      enabled: enabled.has(f.key),
    }));
  }

  /** The permission templates with their granted permission keys. */
  listPermissionTemplates(): Promise<PermissionTemplateView[]> {
    return this.repo.listPermissionTemplates();
  }

  /** Assign a template and/or per-member overrides to a member; audited + cache-invalidating. */
  async assignMemberPermissions(
    principal: RequestPrincipal,
    memberId: string,
    input: AssignMemberInput,
  ): Promise<MemberPermissionsSnapshot> {
    const companyId = this.requireTenant(principal);
    if (input.templateKey === undefined && input.overrides === undefined) {
      throw AppErrors.validation("Provide a templateKey and/or permissions to assign.");
    }
    if (input.templateKey !== undefined) {
      const known = await this.repo.listTemplateKeys();
      if (!known.includes(input.templateKey)) {
        throw AppErrors.validation(`Unknown permission template: ${input.templateKey}.`);
      }
    }

    const member = await this.repo.findMember(companyId, memberId);
    if (member === null) {
      throw AppErrors.notFound("Member not found.");
    }

    const result = await this.repo.assignMemberPermissions({
      companyId,
      memberId,
      actorId: principal.userId,
      ...(input.templateKey !== undefined ? { templateKey: input.templateKey } : {}),
      ...(input.overrides !== undefined ? { overrides: input.overrides } : {}),
    });

    await this.audit.record({
      companyId,
      actorId: principal.userId,
      action: "access.permissions_changed",
      entityType: "company_member",
      entityId: memberId,
      changes: { before: result.before, after: result.after },
    });
    this.cache.invalidateMember(companyId, result.memberUserId);

    return result.after;
  }

  private requireTenant(principal: RequestPrincipal): string {
    if (principal.companyId === null) {
      throw AppErrors.forbidden("Select an active company first.");
    }
    return principal.companyId;
  }
}
