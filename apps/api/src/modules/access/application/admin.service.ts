import { Inject, Injectable } from "@nestjs/common";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppErrors } from "../../../shared/errors/app-exception";
import { CapabilityCache } from "../../../shared/access/capability-cache";
import { EVENT_BUS, type EventBusPort } from "../../../shared/events/event-bus.port";
import { CLOCK, type Clock } from "../../../shared/time/clock";
import { ACCESS_AUDIT, type AccessAuditPort } from "../domain/access-audit.port";
import {
  ACCESS_MANAGEMENT_REPOSITORY,
  type AccessManagementRepositoryPort,
} from "../domain/access-management.port";
import { InvalidCursorInputError } from "../domain/access.errors";
import type { AdminCompanyView, FeatureView } from "../domain/access.types";

/**
 * Orchestrates the platform Super-Admin surface: listing every company and,
 * with no code change, toggling a feature for a company or setting its plan.
 * Every change is audited and invalidates the company's capability cache so the
 * effect is live on the next request. Authorization is the caller's business
 * (the `SuperAdminGuard`); this service assumes an authorized platform admin.
 */
@Injectable()
export class AdminService {
  constructor(
    @Inject(ACCESS_MANAGEMENT_REPOSITORY)
    private readonly repo: AccessManagementRepositoryPort,
    @Inject(ACCESS_AUDIT) private readonly audit: AccessAuditPort,
    @Inject(EVENT_BUS) private readonly events: EventBusPort,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly cache: CapabilityCache,
  ) {}

  /** All companies, keyset-paginated (createdAt desc, id desc). */
  async listCompanies(
    principal: RequestPrincipal,
    rawLimit: number | undefined,
    rawCursor: string | undefined,
  ): Promise<KeysetPage<AdminCompanyView>> {
    try {
      return await this.repo.listAllCompanies(principal.userId, rawLimit, rawCursor);
    } catch (error) {
      if (error instanceof InvalidCursorInputError) {
        throw AppErrors.badRequest("Invalid pagination cursor.");
      }
      throw error;
    }
  }

  /**
   * The full feature catalog, platform-wide — unlike {@link AccessService.listFeatures}
   * this needs no active tenant (a Super-Admin managing companies may not be a
   * member of any). `enabled` has no meaning outside one company's context, so
   * it is always `false` here; the admin surface toggles it per company instead.
   */
  async listFeatureCatalog(): Promise<FeatureView[]> {
    const catalog = await this.repo.listFeatureCatalog();
    return catalog.map((f) => ({ key: f.key, name: f.name, category: f.category, enabled: false }));
  }

  /** Toggle a feature for a company (Super-Admin, no code change). */
  async toggleFeature(
    principal: RequestPrincipal,
    companyId: string,
    featureKey: string,
    enabled: boolean,
  ): Promise<{ featureKey: string; enabled: boolean }> {
    if (!(await this.repo.featureExists(featureKey))) {
      throw AppErrors.notFound(`Unknown feature: ${featureKey}.`);
    }
    await this.repo.setCompanyFeatureFlag({
      companyId,
      featureKey,
      enabled,
      actorId: principal.userId,
    });
    await this.audit.record({
      companyId,
      actorId: principal.userId,
      action: "access.feature_toggled",
      entityType: "company_feature_flag",
      entityId: featureKey,
      changes: { featureKey, enabled },
    });
    this.cache.invalidateCompany(companyId);
    // Additive to the durable audit write: notify subscribers via the bus.
    await this.events.publish({
      type: "access.feature_toggled",
      companyId,
      actorId: principal.userId,
      occurredAt: this.clock.now(),
      payload: { featureKey, enabled },
    });
    return { featureKey, enabled };
  }

  /** Set a company's subscription plan (Super-Admin). */
  async setSubscription(
    principal: RequestPrincipal,
    companyId: string,
    planCode: string,
  ): Promise<{ planCode: string }> {
    const plan = await this.repo.findPlanByCode(planCode);
    if (plan === null) {
      throw AppErrors.notFound(`Unknown plan: ${planCode}.`);
    }
    await this.repo.setSubscription({ companyId, planId: plan.id, actorId: principal.userId });
    await this.audit.record({
      companyId,
      actorId: principal.userId,
      action: "subscription.changed",
      entityType: "subscription",
      entityId: companyId,
      changes: { planCode },
    });
    this.cache.invalidateCompany(companyId);
    await this.events.publish({
      type: "subscription.changed",
      companyId,
      actorId: principal.userId,
      occurredAt: this.clock.now(),
      payload: { planCode },
    });
    return { planCode };
  }
}
