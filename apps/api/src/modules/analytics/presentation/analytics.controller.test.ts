import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { AnalyticsService } from "../application/analytics.service";
import type {
  BusinessSummary,
  InventorySummary,
  ProductsSummary,
  ProfitabilitySummary,
  StaffSummary,
} from "../domain/analytics.entity";
import { AnalyticsController } from "./analytics.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

function business(): BusinessSummary {
  return {
    orderCount: 10,
    collectedMinor: 100000,
    averageOrderValueMinor: 10000,
    orderCountDeltaPct: 12.5,
    collectedDeltaPct: null,
    series: [{ bucket: "2026-01-01T00:00:00.000Z", orderCount: 10, collectedMinor: 100000 }],
    granularity: "day",
  };
}

function products(): ProductsSummary {
  return {
    top: [
      { variantId: "v1", productName: "P1", variantName: "V1", unitsSold: 5, revenueMinor: 5000 },
    ],
    bottom: [],
  };
}

function inventory(): InventorySummary {
  return { onHandValueMinor: 500000, lowStockCount: 2, outOfStockCount: 1, turnoverSignal: 0.25 };
}

function staff(): StaffSummary {
  return {
    rows: [{ assigneeId: "u1", assigneeName: "Amina", orderCount: 3, collectedMinor: 30000 }],
  };
}

function profitability(): ProfitabilitySummary {
  return {
    current: {
      collectedMinor: 100000,
      cogsMinor: 40000,
      expensesMinor: 20000,
      netIncomeMinor: 40000,
    },
    previous: {
      collectedMinor: 80000,
      cogsMinor: 30000,
      expensesMinor: 20000,
      netIncomeMinor: 30000,
    },
    netIncomeDeltaPct: 33.33,
  };
}

type ServiceMock = { [K in keyof AnalyticsService]: ReturnType<typeof vi.fn> };

function makeService(): ServiceMock {
  return {
    getBusiness: vi.fn().mockResolvedValue(business()),
    getProducts: vi.fn().mockResolvedValue(products()),
    getInventory: vi.fn().mockResolvedValue(inventory()),
    getStaff: vi.fn().mockResolvedValue(staff()),
    getProfitability: vi.fn().mockResolvedValue(profitability()),
    exportAxis: vi.fn().mockResolvedValue({
      filename: "analytics-business-2026-01-01-2026-01-31.csv",
      contentType: "text/csv; charset=utf-8",
      body: "metric,orderCount\r\n",
    }),
  } as unknown as ServiceMock;
}

function makeResponse(): Response & {
  status: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
} {
  const res = { status: vi.fn(), setHeader: vi.fn(), send: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
}

describe("AnalyticsController", () => {
  it("renders the business axis", async () => {
    const service = makeService();
    const controller = new AnalyticsController(service as unknown as AnalyticsService);
    const dto = await controller.business(principal, {});
    expect(service.getBusiness).toHaveBeenCalledWith(principal, {});
    expect(dto.orderCount).toBe(10);
    expect(dto.series).toHaveLength(1);
  });

  it("renders the products axis", async () => {
    const service = makeService();
    const controller = new AnalyticsController(service as unknown as AnalyticsService);
    const dto = await controller.products(principal, {});
    expect(service.getProducts).toHaveBeenCalledWith(principal, {});
    expect(dto.top).toHaveLength(1);
  });

  it("renders the inventory axis", async () => {
    const service = makeService();
    const controller = new AnalyticsController(service as unknown as AnalyticsService);
    const dto = await controller.inventory(principal, {});
    expect(service.getInventory).toHaveBeenCalledWith(principal, {});
    expect(dto.turnoverSignal).toBe(0.25);
  });

  it("renders the staff axis", async () => {
    const service = makeService();
    const controller = new AnalyticsController(service as unknown as AnalyticsService);
    const dto = await controller.staff(principal, {});
    expect(service.getStaff).toHaveBeenCalledWith(principal, {});
    expect(dto.rows).toHaveLength(1);
  });

  it("renders the profitability axis", async () => {
    const service = makeService();
    const controller = new AnalyticsController(service as unknown as AnalyticsService);
    const dto = await controller.profitability(principal, {});
    expect(service.getProfitability).toHaveBeenCalledWith(principal, {});
    expect(dto.current.netIncomeMinor).toBe(40000);
  });

  it("streams the export as a CSV attachment", async () => {
    const service = makeService();
    const controller = new AnalyticsController(service as unknown as AnalyticsService);
    const res = makeResponse();
    await controller.export(principal, { axis: "business" }, res);

    expect(service.exportAxis).toHaveBeenCalledWith(principal, { axis: "business" });
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv; charset=utf-8");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="analytics-business-2026-01-01-2026-01-31.csv"',
    );
    expect(res.send).toHaveBeenCalledWith("metric,orderCount\r\n");
  });
});
