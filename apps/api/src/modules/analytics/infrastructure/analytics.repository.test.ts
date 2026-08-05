/**
 * Happy-path coverage for the analytics repository (EPIC-14, M14.2): every
 * axis's aggregate read, mocked at the Prisma delegate / `$queryRaw`
 * boundary the same way `finance.repository.test.ts` does. Each
 * `tenantTx` opens with one `$queryRaw` call for `setTenantContext`
 * (mocked away first), then the method's own reads follow.
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@cadeau/database";
import { AnalyticsRepository } from "./analytics.repository";

const COMPANY = "11111111-1111-1111-1111-111111111111";

function delegate() {
  return {
    aggregate: vi.fn().mockResolvedValue({ _sum: {}, _count: { _all: 0 } }),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  };
}

function makeRepo() {
  const models = {
    order: delegate(),
    orderItem: delegate(),
    inventoryStock: delegate(),
    expense: delegate(),
  };
  const queryRaw = vi.fn().mockResolvedValue([]);
  const txHost = { $queryRaw: queryRaw, ...models };
  const prisma = { $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(txHost)) };
  return { repo: new AnalyticsRepository(prisma as unknown as PrismaClient), models, queryRaw };
}

const WINDOW = {
  from: new Date("2026-01-01T00:00:00.000Z"),
  to: new Date("2026-01-31T00:00:00.000Z"),
};

describe("AnalyticsRepository — business", () => {
  it("computes current/previous aggregates and the bucketed series", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.order.aggregate
      .mockResolvedValueOnce({ _count: { _all: 10 }, _sum: { collectedAmount: 100000n } })
      .mockResolvedValueOnce({ _count: { _all: 8 }, _sum: { collectedAmount: 80000n } });
    queryRaw
      .mockResolvedValueOnce([]) // setTenantContext
      .mockResolvedValueOnce([
        { bucket: new Date("2026-01-01T00:00:00.000Z"), order_count: 5n, collected_minor: 50000n },
      ]);

    const facts = await repo.getBusinessFacts(COMPANY, WINDOW, "day");

    expect(facts.orderCount).toBe(10);
    expect(facts.collectedMinor).toBe(100000);
    expect(facts.previousOrderCount).toBe(8);
    expect(facts.previousCollectedMinor).toBe(80000);
    expect(facts.series).toEqual([
      { bucket: "2026-01-01T00:00:00.000Z", orderCount: 5, collectedMinor: 50000 },
    ]);
  });

  it("defaults null sums to zero", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.order.aggregate
      .mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { collectedAmount: null } })
      .mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { collectedAmount: null } });
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const facts = await repo.getBusinessFacts(COMPANY, WINDOW, "week");
    expect(facts.collectedMinor).toBe(0);
    expect(facts.series).toEqual([]);
  });
});

describe("AnalyticsRepository — products", () => {
  it("maps raw rows into performance rows", async () => {
    const { repo, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        variant_id: "v1",
        product_name: "Widget",
        variant_name: "Red",
        units_sold: 12n,
        revenue_minor: 60000n,
      },
    ]);

    const rows = await repo.getProductPerformance(COMPANY, WINDOW);
    expect(rows).toEqual([
      {
        variantId: "v1",
        productName: "Widget",
        variantName: "Red",
        unitsSold: 12,
        revenueMinor: 60000,
      },
    ]);
  });

  it("returns an empty list when there is no activity", async () => {
    const { repo, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await repo.getProductPerformance(COMPANY, WINDOW)).toEqual([]);
  });
});

describe("AnalyticsRepository — inventory", () => {
  it("computes value/low-stock/out-of-stock from the raw aggregate row", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw
      .mockResolvedValueOnce([]) // setTenantContext
      .mockResolvedValueOnce([
        { value_minor: 500000n, low_stock_count: 2n, out_of_stock_count: 1n },
      ]);
    models.orderItem.aggregate.mockResolvedValueOnce({ _sum: { quantity: 40n } });
    models.inventoryStock.aggregate.mockResolvedValueOnce({ _sum: { onHand: 200n } });

    const facts = await repo.getInventoryFacts(COMPANY, WINDOW);
    expect(facts).toEqual({
      onHandValueMinor: 500000,
      lowStockCount: 2,
      outOfStockCount: 1,
      unitsSoldInWindow: 40,
      totalOnHandUnits: 200,
    });
  });

  it("defaults to zero when the stock query returns no row", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    models.orderItem.aggregate.mockResolvedValueOnce({ _sum: { quantity: null } });
    models.inventoryStock.aggregate.mockResolvedValueOnce({ _sum: { onHand: null } });

    const facts = await repo.getInventoryFacts(COMPANY, WINDOW);
    expect(facts.onHandValueMinor).toBe(0);
    expect(facts.totalOnHandUnits).toBe(0);
  });
});

describe("AnalyticsRepository — staff", () => {
  it("maps raw rows, defaulting an unnamed assignee to Unassigned", async () => {
    const { repo, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { assignee_id: "u1", assignee_name: "Amina", order_count: 3n, collected_minor: 30000n },
      { assignee_id: null, assignee_name: null, order_count: 1n, collected_minor: 5000n },
    ]);

    const rows = await repo.getStaffPerformance(COMPANY, WINDOW);
    expect(rows).toEqual([
      { assigneeId: "u1", assigneeName: "Amina", orderCount: 3, collectedMinor: 30000 },
      { assigneeId: null, assigneeName: "Unassigned", orderCount: 1, collectedMinor: 5000 },
    ]);
  });
});

describe("AnalyticsRepository — profitability", () => {
  it("computes collected/COGS/expenses from three parallel reads", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    models.order.aggregate.mockResolvedValueOnce({ _sum: { collectedAmount: 100000n } });
    models.orderItem.findMany.mockResolvedValueOnce([
      { costSnapshot: 1000n, quantity: 5n },
      { costSnapshot: 500n, quantity: 2n },
    ]);
    models.expense.aggregate.mockResolvedValueOnce({ _sum: { amountMinor: 20000n } });

    const facts = await repo.getProfitabilityFacts(COMPANY, WINDOW);
    expect(facts).toEqual({ collectedMinor: 100000, cogsMinor: 6000, expensesMinor: 20000 });
  });

  it("defaults to zero with no activity", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]);
    models.order.aggregate.mockResolvedValueOnce({ _sum: { collectedAmount: null } });
    models.orderItem.findMany.mockResolvedValueOnce([]);
    models.expense.aggregate.mockResolvedValueOnce({ _sum: { amountMinor: null } });

    const facts = await repo.getProfitabilityFacts(COMPANY, WINDOW);
    expect(facts).toEqual({ collectedMinor: 0, cogsMinor: 0, expensesMinor: 0 });
  });
});
