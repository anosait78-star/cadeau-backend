import { describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { FinanceService } from "../application/finance.service";
import type { AccountingPeriodView } from "../domain/finance.entity";
import { PeriodsController } from "./periods.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

function period(extra: Partial<AccountingPeriodView> = {}): AccountingPeriodView {
  return {
    id: "period1",
    periodKey: "2026-01",
    status: "open",
    closedAt: null,
    closedBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

type ServiceMock = { [K in keyof FinanceService]: ReturnType<typeof vi.fn> };

function makeService(): ServiceMock {
  return {
    listPeriods: vi.fn().mockResolvedValue([period()]),
    closePeriod: vi.fn().mockResolvedValue(period({ status: "closed" })),
  } as unknown as ServiceMock;
}

describe("PeriodsController", () => {
  it("renders the periods list", async () => {
    const service = makeService();
    const controller = new PeriodsController(service as unknown as FinanceService);
    const rows = await controller.list(principal);
    expect(service.listPeriods).toHaveBeenCalledWith(principal);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.periodKey).toBe("2026-01");
  });

  it("closes a period with the path period key", async () => {
    const service = makeService();
    const controller = new PeriodsController(service as unknown as FinanceService);
    const dto = await controller.close(principal, "2026-01");
    expect(service.closePeriod).toHaveBeenCalledWith(principal, "2026-01");
    expect(dto.status).toBe("closed");
  });
});
