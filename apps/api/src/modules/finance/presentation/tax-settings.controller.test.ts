import { describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { FinanceService } from "../application/finance.service";
import type { TaxSettingsView } from "../domain/finance.entity";
import { TaxSettingsController } from "./tax-settings.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

function taxSettings(extra: Partial<TaxSettingsView> = {}): TaxSettingsView {
  return {
    companyId: principal.companyId as string,
    vatRateBps: 0,
    vatRegistrationNumber: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

type ServiceMock = { [K in keyof FinanceService]: ReturnType<typeof vi.fn> };

function makeService(): ServiceMock {
  return {
    getTaxSettings: vi.fn().mockResolvedValue(taxSettings()),
    updateTaxSettings: vi.fn().mockResolvedValue(taxSettings({ vatRateBps: 1400 })),
  } as unknown as ServiceMock;
}

describe("TaxSettingsController", () => {
  it("renders the tax settings", async () => {
    const service = makeService();
    const controller = new TaxSettingsController(service as unknown as FinanceService);
    const dto = await controller.get(principal);
    expect(service.getTaxSettings).toHaveBeenCalledWith(principal);
    expect(dto.vatRateBps).toBe(0);
  });

  it("updates the VAT rate", async () => {
    const service = makeService();
    const controller = new TaxSettingsController(service as unknown as FinanceService);
    const dto = await controller.update(principal, { vatRateBps: 1400 });
    expect(service.updateTaxSettings).toHaveBeenCalledWith(principal, { vatRateBps: 1400 });
    expect(dto.vatRateBps).toBe(1400);
  });
});
