import { Inject, Injectable } from "@nestjs/common";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppErrors } from "../../../shared/errors/app-exception";
import { AnalyticsCache } from "./analytics-cache";
import { ANALYTICS_AUDIT, type AnalyticsAuditPort } from "../domain/analytics-audit.port";
import {
  businessSummaryToCsv,
  inventorySummaryToCsv,
  productsRowsToCsv,
  profitabilitySummaryToCsv,
  staffRowsToCsv,
} from "../domain/analytics-csv";
import {
  computeBusinessSummary,
  computeInventorySummary,
  computeProductsSummary,
  computeProfitabilitySummary,
  type BusinessSummary,
  type InventorySummary,
  type ProductsSummary,
  type ProfitabilitySummary,
  type StaffSummary,
} from "../domain/analytics.entity";
import {
  parseAnalyticsQuery,
  parseExportRequest,
  precedingWindow,
  type ParsedAnalyticsQuery,
  type RawAnalyticsQuery,
  type RawExportRequest,
} from "../domain/analytics-query";
import {
  ANALYTICS_REPOSITORY,
  type AnalyticsRepositoryPort,
} from "../domain/analytics-repository.port";

/** A rendered export: CSV bytes plus a suggested filename. */
export interface ExportResult {
  readonly filename: string;
  readonly contentType: string;
  readonly body: string;
}

/**
 * Orchestrates the five read-only analytics axes (EPIC-14, M14.2/M14.3): for
 * each axis, resolves the caller's tenant, validates the window/granularity,
 * serves from the in-process TTL cache when present (D2), otherwise reads
 * the aggregate facts from the repository and runs the pure domain
 * calculation, caching the result. `exportAxis` reuses the same computation
 * and additionally writes a durable audit row before returning the
 * rendered CSV (D7) — no domain event follows (the contract specifies none
 * for this read-only module). Access is gated by the controller's
 * `@RequireCapability`; this service assumes an authorized caller.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(ANALYTICS_REPOSITORY) private readonly repo: AnalyticsRepositoryPort,
    @Inject(ANALYTICS_AUDIT) private readonly audit: AnalyticsAuditPort,
    private readonly cache: AnalyticsCache,
  ) {}

  async getBusiness(
    principal: RequestPrincipal,
    rawQuery: RawAnalyticsQuery,
  ): Promise<BusinessSummary> {
    const companyId = this.requireTenant(principal);
    const query = this.parseWindow(rawQuery);
    const key = AnalyticsCache.key(companyId, "business", query.from, query.to, query.granularity);
    const cached = this.cache.get<BusinessSummary>(key);
    if (cached !== null) return cached;

    const facts = await this.repo.getBusinessFacts(
      companyId,
      { from: query.from, to: query.to },
      query.granularity,
    );
    const summary = computeBusinessSummary(facts, query.granularity);
    this.cache.set(key, summary);
    return summary;
  }

  async getProducts(
    principal: RequestPrincipal,
    rawQuery: RawAnalyticsQuery,
  ): Promise<ProductsSummary> {
    const companyId = this.requireTenant(principal);
    const query = this.parseWindow(rawQuery);
    const key = AnalyticsCache.key(companyId, "products", query.from, query.to, query.granularity);
    const cached = this.cache.get<ProductsSummary>(key);
    if (cached !== null) return cached;

    const rows = await this.repo.getProductPerformance(companyId, {
      from: query.from,
      to: query.to,
    });
    const summary = computeProductsSummary(rows);
    this.cache.set(key, summary);
    return summary;
  }

  async getInventory(
    principal: RequestPrincipal,
    rawQuery: RawAnalyticsQuery,
  ): Promise<InventorySummary> {
    const companyId = this.requireTenant(principal);
    const query = this.parseWindow(rawQuery);
    const key = AnalyticsCache.key(companyId, "inventory", query.from, query.to, query.granularity);
    const cached = this.cache.get<InventorySummary>(key);
    if (cached !== null) return cached;

    const facts = await this.repo.getInventoryFacts(companyId, { from: query.from, to: query.to });
    const summary = computeInventorySummary(facts);
    this.cache.set(key, summary);
    return summary;
  }

  async getStaff(principal: RequestPrincipal, rawQuery: RawAnalyticsQuery): Promise<StaffSummary> {
    const companyId = this.requireTenant(principal);
    const query = this.parseWindow(rawQuery);
    const key = AnalyticsCache.key(companyId, "staff", query.from, query.to, query.granularity);
    const cached = this.cache.get<StaffSummary>(key);
    if (cached !== null) return cached;

    const rows = await this.repo.getStaffPerformance(companyId, {
      from: query.from,
      to: query.to,
    });
    const summary: StaffSummary = { rows };
    this.cache.set(key, summary);
    return summary;
  }

  async getProfitability(
    principal: RequestPrincipal,
    rawQuery: RawAnalyticsQuery,
  ): Promise<ProfitabilitySummary> {
    const companyId = this.requireTenant(principal);
    const query = this.parseWindow(rawQuery);
    const key = AnalyticsCache.key(
      companyId,
      "profitability",
      query.from,
      query.to,
      query.granularity,
    );
    const cached = this.cache.get<ProfitabilitySummary>(key);
    if (cached !== null) return cached;

    const previous = precedingWindow(query.from, query.to);
    const [current, previousFacts] = await Promise.all([
      this.repo.getProfitabilityFacts(companyId, { from: query.from, to: query.to }),
      this.repo.getProfitabilityFacts(companyId, previous),
    ]);
    const summary = computeProfitabilitySummary(current, previousFacts);
    this.cache.set(key, summary);
    return summary;
  }

  async exportAxis(principal: RequestPrincipal, rawBody: RawExportRequest): Promise<ExportResult> {
    const companyId = this.requireTenant(principal);
    const { query, errors } = parseExportRequest(rawBody);
    if (query === undefined) throw AppErrors.validation("Request validation failed", errors);

    const rawQuery: RawAnalyticsQuery = {
      from: query.window.from.toISOString(),
      to: query.window.to.toISOString(),
      granularity: query.window.granularity,
    };

    let body: string;
    let rowCount: number;
    switch (query.axis) {
      case "business": {
        const summary = await this.getBusiness(principal, rawQuery);
        body = businessSummaryToCsv(summary);
        rowCount = summary.series.length + 1;
        break;
      }
      case "products": {
        const summary = await this.getProducts(principal, rawQuery);
        body = productsRowsToCsv(summary);
        rowCount = summary.top.length + summary.bottom.length;
        break;
      }
      case "inventory": {
        const summary = await this.getInventory(principal, rawQuery);
        body = inventorySummaryToCsv(summary);
        rowCount = 1;
        break;
      }
      case "staff": {
        const summary = await this.getStaff(principal, rawQuery);
        body = staffRowsToCsv(summary.rows);
        rowCount = summary.rows.length;
        break;
      }
      case "profitability": {
        const summary = await this.getProfitability(principal, rawQuery);
        body = profitabilitySummaryToCsv(summary);
        rowCount = 2;
        break;
      }
    }

    await this.audit.record({
      companyId,
      actorId: principal.userId,
      action: "analytics.exported",
      entityType: "analytics_export",
      entityId: query.axis,
      changes: { axis: query.axis, from: rawQuery.from, to: rawQuery.to, rowCount },
    });

    return {
      filename: `analytics-${query.axis}-${query.window.from.toISOString().slice(0, 10)}-${query.window.to
        .toISOString()
        .slice(0, 10)}.csv`,
      contentType: "text/csv; charset=utf-8",
      body,
    };
  }

  // ---- internals -----------------------------------------------------------

  private parseWindow(rawQuery: RawAnalyticsQuery): ParsedAnalyticsQuery {
    const { query, errors } = parseAnalyticsQuery(rawQuery);
    if (query === undefined) throw AppErrors.validation("Request validation failed", errors);
    return query;
  }

  private requireTenant(principal: RequestPrincipal): string {
    if (principal.companyId === null) {
      throw AppErrors.forbidden("Select an active company first.");
    }
    return principal.companyId;
  }
}
