import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { VendorPayoutsService } from "../application/vendor-payouts.service";
import type {
  LedgerEntryView,
  PayoutView,
  VendorBalanceView,
} from "../domain/vendor-payout.entity";
import { VendorAccountController } from "./vendor-account.controller";
import { VendorPayoutsController } from "./vendor-payouts.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};
const WAREHOUSE = "33333333-3333-3333-3333-333333333333";
const PAYOUT = "44444444-4444-4444-4444-444444444444";

const balance: VendorBalanceView = {
  warehouseId: WAREHOUSE,
  warehouseName: "Vendor A",
  vendorName: "Ali",
  owedMinor: 18000,
  pendingMinor: 0,
  paidMinor: 5000,
  needsPricingCount: 1,
  pendingPayoutId: null,
};

const payout: PayoutView = {
  id: PAYOUT,
  warehouseId: WAREHOUSE,
  warehouseName: "Vendor A",
  amountMinor: 18000,
  method: "cash",
  reference: null,
  notes: null,
  status: "pending",
  confirmationKind: null,
  forceReason: null,
  confirmedAt: null,
  cancelledAt: null,
  entryCount: 2,
  createdAt: "2026-11-17T10:00:00.000Z",
};

const entry: LedgerEntryView = {
  id: "e1",
  kind: "accrual",
  orderId: "o1",
  orderNumber: 1042,
  variantId: "v1",
  nameSnapshot: "Mug",
  quantity: 2,
  unitCostMinor: 9000,
  amountMinor: 18000,
  needsPricing: false,
  payoutId: null,
  state: "open",
  note: null,
  createdAt: "2026-11-17T10:00:00.000Z",
};

const page = <T>(data: T[]) => ({ data, page: { limit: 25, nextCursor: null, hasMore: false } });

function makeService() {
  return {
    listVendors: vi.fn().mockResolvedValue([balance]),
    getVendor: vi.fn().mockResolvedValue(balance),
    listVendorLedger: vi.fn().mockResolvedValue(page([entry])),
    listCompanyPayouts: vi.fn().mockResolvedValue(page([payout])),
    requestPayout: vi.fn().mockResolvedValue({ payout, replayed: false }),
    cancelPayout: vi.fn().mockResolvedValue({ ...payout, status: "cancelled" }),
    forceConfirmPayout: vi.fn().mockResolvedValue({ ...payout, status: "confirmed" }),
    createAdjustment: vi.fn().mockResolvedValue({ ...entry, kind: "adjustment" }),
    getMyAccount: vi.fn().mockResolvedValue(balance),
    listMyLedger: vi.fn().mockResolvedValue(page([entry])),
    listMyPayouts: vi.fn().mockResolvedValue(page([payout])),
    confirmMyPayout: vi.fn().mockResolvedValue({ ...payout, status: "confirmed" }),
  };
}

function fakeResponse() {
  return { status: vi.fn() } as unknown as Response & { status: ReturnType<typeof vi.fn> };
}

describe("VendorPayoutsController", () => {
  const service = makeService();
  const controller = new VendorPayoutsController(service as unknown as VendorPayoutsService);

  it("serves the vendors list, one vendor and their statement", async () => {
    expect((await controller.listVendors(principal)).data[0]).toMatchObject({ owedMinor: 18000 });
    expect(await controller.getVendor(principal, WAREHOUSE)).toMatchObject({ paidMinor: 5000 });
    const ledger = await controller.listLedger(principal, WAREHOUSE, { limit: "10" });
    expect(service.listVendorLedger).toHaveBeenCalledWith(principal, WAREHOUSE, { limit: "10" });
    expect(ledger.data[0]).toMatchObject({ orderNumber: 1042 });
  });

  it("filters payouts by the optional warehouse query", async () => {
    const result = await controller.listPayouts(principal, { warehouseId: WAREHOUSE });
    expect(service.listCompanyPayouts).toHaveBeenCalledWith(principal, WAREHOUSE, {
      warehouseId: WAREHOUSE,
    });
    expect(result.page.hasMore).toBe(false);
  });

  it("answers 201 for a new payout and 200 for a replay, passing the header through", async () => {
    const res = fakeResponse();
    await controller.requestPayout(principal, WAREHOUSE, { method: "cash" }, "key-1", res);
    expect(service.requestPayout).toHaveBeenCalledWith(principal, WAREHOUSE, {
      method: "cash",
      idempotencyKey: "key-1",
    });
    expect(res.status).toHaveBeenCalledWith(201);

    service.requestPayout.mockResolvedValueOnce({ payout, replayed: true });
    const replay = fakeResponse();
    await controller.requestPayout(principal, WAREHOUSE, { method: "cash" }, "key-1", replay);
    expect(replay.status).toHaveBeenCalledWith(200);
  });

  it("cancels, force-confirms and adjusts", async () => {
    expect((await controller.cancel(principal, PAYOUT)).status).toBe("cancelled");
    expect((await controller.forceConfirm(principal, PAYOUT, { reason: "phone" })).status).toBe(
      "confirmed",
    );
    expect(service.forceConfirmPayout).toHaveBeenCalledWith(principal, PAYOUT, "phone");
    const adjustment = await controller.createAdjustment(principal, WAREHOUSE, {
      amountMinor: -500,
      note: "exchange",
    });
    expect(adjustment.kind).toBe("adjustment");
  });
});

describe("VendorAccountController", () => {
  const service = makeService();
  const controller = new VendorAccountController(service as unknown as VendorPayoutsService);

  it("serves the vendor's own account, statement and payouts", async () => {
    expect(await controller.get(principal)).toMatchObject({ warehouseId: WAREHOUSE });
    expect((await controller.ledger(principal, {})).data).toHaveLength(1);
    expect((await controller.payouts(principal, {})).data[0]).toMatchObject({ id: PAYOUT });
  });

  it("confirms receipt of a payout", async () => {
    const result = await controller.confirm(principal, PAYOUT);
    expect(service.confirmMyPayout).toHaveBeenCalledWith(principal, PAYOUT);
    expect(result.status).toBe("confirmed");
  });
});
