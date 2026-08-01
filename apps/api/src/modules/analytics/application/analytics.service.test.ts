import { describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppException } from "../../../shared/errors/app-exception";
import type { Clock } from "../../../shared/time/clock";
import type { AnalyticsAuditPort } from "../domain/analytics-audit.port";
import type { AnalyticsRepositoryPort, Window } from "../domain/analytics-repository.port";
import type { Granularity } from "../domain/analytics-query";
import { AnalyticsCache } from "./analytics-cache";
import { AnalyticsService } from "./analytics.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

function principal(overrides: Partial<RequestPrincipal> = {}): RequestPrincipal {
  return { userId: USER, sessionId: "s", companyId: COMPANY, ...overrides };
}

function fakeClock(): Clock {
  let now = 0;
  return { now: () => now++ };
}

function fakeRepo(overrides: Partial<AnalyticsRepositoryPort> = {}): AnalyticsRepositoryPort {
  return {
    getBusinessFacts: vi.fn(async (_c: string, _w: Window, _g: Granularity) => ({
      orderCount: 10,
      collectedMinor: 100000,
      previousOrderCount: 8,
      previousCollectedMinor: 80000,
      series: [],
    })),
    getProductPerformance: vi.fn(async () => []),
    getInventoryFacts: vi.fn(async () => ({
      onHandValueMinor: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
      unitsSoldInWindow: 0,
      totalOnHandUnits: 0,
    })),
    getStaffPerformance: vi.fn(async () => []),
    getProfitabilityFacts: vi.fn(async () => ({
      collectedMinor: 100000,
      cogsMinor: 40000,
      expensesMinor: 20000,
    })),
    ...overrides,
  };
}

function fakeAudit(): AnalyticsAuditPort & { record: ReturnType<typeof vi.fn> } {
  return { record: vi.fn(async () => undefined) };
}

function makeService(repoOverrides: Partial<AnalyticsRepositoryPort> = {}) {
  const repo = fakeRepo(repoOverrides);
  const audit = fakeAudit();
  const cache = new AnalyticsCache(fakeClock());
  const service = new AnalyticsService(repo, audit, cache);
  return { service, repo, audit, cache };
}

describe("AnalyticsService", () => {
  it("rejects a caller with no active company", async () => {
    const { service } = makeService();
    await expect(service.getBusiness(principal({ companyId: null }), {})).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it("computes the business summary from repository facts", async () => {
    const { service } = makeService();
    const summary = await service.getBusiness(principal(), {});
    expect(summary.orderCount).toBe(10);
    expect(summary.averageOrderValueMinor).toBe(10000);
    expect(summary.orderCountDeltaPct).toBe(25);
  });

  it("serves a repeated request for the same window from cache (no second repo call)", async () => {
    const { service, repo } = makeService();
    const query = { from: "2026-01-01T00:00:00.000Z", to: "2026-01-31T00:00:00.000Z" };
    await service.getBusiness(principal(), query);
    await service.getBusiness(principal(), query);
    expect(repo.getBusinessFacts).toHaveBeenCalledTimes(1);
  });

  it("does not serve cache across a different window", async () => {
    const { service, repo } = makeService();
    await service.getBusiness(principal(), {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-31T00:00:00.000Z",
    });
    await service.getBusiness(principal(), {
      from: "2026-02-01T00:00:00.000Z",
      to: "2026-02-28T00:00:00.000Z",
    });
    expect(repo.getBusinessFacts).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid window with a validation error", async () => {
    const { service } = makeService();
    await expect(service.getBusiness(principal(), { granularity: "year" })).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it("computes products top/bottom from repository rows", async () => {
    const { service } = makeService({
      getProductPerformance: vi.fn(async () => [
        { variantId: "v1", productName: "P1", variantName: "V1", unitsSold: 5, revenueMinor: 5000 },
      ]),
    });
    const summary = await service.getProducts(principal(), {});
    expect(summary.top).toHaveLength(1);
  });

  it("computes the inventory summary", async () => {
    const { service } = makeService({
      getInventoryFacts: vi.fn(async () => ({
        onHandValueMinor: 1000,
        lowStockCount: 1,
        outOfStockCount: 0,
        unitsSoldInWindow: 10,
        totalOnHandUnits: 100,
      })),
    });
    const summary = await service.getInventory(principal(), {});
    expect(summary.turnoverSignal).toBe(0.1);
  });

  it("computes the staff summary", async () => {
    const { service } = makeService({
      getStaffPerformance: vi.fn(async () => [
        { assigneeId: "u1", assigneeName: "Amina", orderCount: 3, collectedMinor: 30000 },
      ]),
    });
    const summary = await service.getStaff(principal(), {});
    expect(summary.rows).toHaveLength(1);
  });

  it("computes profitability as current vs. the preceding window", async () => {
    const { service, repo } = makeService();
    const summary = await service.getProfitability(principal(), {});
    expect(summary.current.netIncomeMinor).toBe(40000);
    expect(repo.getProfitabilityFacts).toHaveBeenCalledTimes(2);
  });

  it("exports an axis as CSV and writes an audit row before returning", async () => {
    const { service, audit } = makeService();
    const result = await service.exportAxis(principal(), { axis: "business" });
    expect(result.contentType).toContain("text/csv");
    expect(result.filename).toContain("analytics-business-");
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0]?.[0]).toMatchObject({
      companyId: COMPANY,
      actorId: USER,
      action: "analytics.exported",
      entityType: "analytics_export",
      entityId: "business",
    });
  });

  it("rejects an export with an invalid axis", async () => {
    const { service } = makeService();
    await expect(service.exportAxis(principal(), { axis: "forecast" })).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it("exports every axis without throwing", async () => {
    const { service } = makeService({
      getProductPerformance: vi.fn(async () => [
        { variantId: "v1", productName: "P1", variantName: "V1", unitsSold: 5, revenueMinor: 5000 },
      ]),
      getStaffPerformance: vi.fn(async () => [
        { assigneeId: "u1", assigneeName: "Amina", orderCount: 3, collectedMinor: 30000 },
      ]),
    });
    for (const axis of ["business", "products", "inventory", "staff", "profitability"] as const) {
      const result = await service.exportAxis(principal(), { axis });
      expect(result.body.length).toBeGreaterThan(0);
    }
  });
});
