import { describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { FinanceService } from "../application/finance.service";
import type { CashCenterReportView, PnlReportView } from "../domain/finance.entity";
import { ReportsController } from "./reports.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

function cashCenter(): CashCenterReportView {
  return {
    collectedMinor: 500000,
    expensesMinor: 80000,
    purchaseOrderPaymentsMinor: 120000,
    refundsMinor: 10000,
    shippingFeesMinor: 30000,
    netCashMinor: 260000,
  };
}

function pnl(): PnlReportView {
  return {
    current: {
      revenueMinor: 100000,
      cogsMinor: 40000,
      expensesMinor: 10000,
      netIncomeMinor: 50000,
    },
  };
}

type ServiceMock = { [K in keyof FinanceService]: ReturnType<typeof vi.fn> };

function makeService(): ServiceMock {
  return {
    getCashCenterReport: vi.fn().mockResolvedValue(cashCenter()),
    getPnlReport: vi.fn().mockResolvedValue(pnl()),
  } as unknown as ServiceMock;
}

describe("ReportsController", () => {
  it("renders the cash-center report", async () => {
    const service = makeService();
    const controller = new ReportsController(service as unknown as FinanceService);
    const query = { dateFrom: "2026-01-01T00:00:00.000Z", dateTo: "2026-01-31T23:59:59.000Z" };
    const dto = await controller.cashCenter(principal, query);
    expect(service.getCashCenterReport).toHaveBeenCalledWith(principal, query);
    expect(dto.netCashMinor).toBe(260000);
  });

  it("renders the P&L report", async () => {
    const service = makeService();
    const controller = new ReportsController(service as unknown as FinanceService);
    const query = { dateFrom: "2026-01-01T00:00:00.000Z", dateTo: "2026-01-31T23:59:59.000Z" };
    const dto = await controller.pnl(principal, query);
    expect(service.getPnlReport).toHaveBeenCalledWith(principal, query);
    expect(dto.current.netIncomeMinor).toBe(50000);
    expect(dto.previous).toBeUndefined();
  });
});
