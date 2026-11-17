import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidCursorError } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppException } from "../../../shared/errors/app-exception";
import type { EventBusPort } from "../../../shared/events/event-bus.port";
import type { Clock } from "../../../shared/time/clock";
import type {
  LedgerEntryView,
  PayoutView,
  VendorBalanceView,
} from "../domain/vendor-payout.entity";
import type { VendorPayoutsAuditPort } from "../domain/vendor-payouts-audit.port";
import type { VendorPayoutsRepositoryPort } from "../domain/vendor-payouts-repository.port";
import {
  IdempotencyKeyReusedError,
  NothingToPayError,
  PayoutAlreadyPendingError,
  PayoutNotFoundError,
  PayoutNotPendingError,
  PayoutPeriodClosedError,
  VendorNotFoundError,
} from "../domain/vendor-payouts.errors";
import { VendorPayoutsService } from "./vendor-payouts.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const WAREHOUSE = "33333333-3333-3333-3333-333333333333";
const PAYOUT = "44444444-4444-4444-4444-444444444444";

const principal = { userId: USER, companyId: COMPANY } as unknown as RequestPrincipal;

function payout(extra: Partial<PayoutView> = {}): PayoutView {
  return {
    id: PAYOUT,
    warehouseId: WAREHOUSE,
    warehouseName: "Vendor A",
    amountMinor: 18000,
    method: "instapay",
    reference: null,
    notes: null,
    status: "pending",
    confirmationKind: null,
    forceReason: null,
    confirmedAt: null,
    cancelledAt: null,
    entryCount: 2,
    createdAt: "2026-11-17T10:00:00.000Z",
    ...extra,
  };
}

function balance(): VendorBalanceView {
  return {
    warehouseId: WAREHOUSE,
    warehouseName: "Vendor A",
    vendorName: "Ali",
    owedMinor: 18000,
    pendingMinor: 0,
    paidMinor: 0,
    needsPricingCount: 0,
    pendingPayoutId: null,
  };
}

function entry(): LedgerEntryView {
  return {
    id: "e1",
    kind: "adjustment",
    orderId: null,
    orderNumber: null,
    variantId: null,
    nameSnapshot: null,
    quantity: null,
    unitCostMinor: null,
    amountMinor: -500,
    needsPricing: false,
    payoutId: null,
    state: "open",
    note: "exchange",
    createdAt: "2026-11-17T10:00:00.000Z",
  };
}

const EMPTY_PAGE = { data: [], page: { limit: 25, nextCursor: null, hasMore: false } };

function makeService() {
  const repo = {
    findMemberScope: vi.fn().mockResolvedValue({ warehouseId: null }),
    listVendorBalances: vi.fn().mockResolvedValue([balance()]),
    getVendorBalance: vi.fn().mockResolvedValue(balance()),
    listLedger: vi.fn().mockResolvedValue(EMPTY_PAGE),
    listPayouts: vi.fn().mockResolvedValue(EMPTY_PAGE),
    findPayout: vi.fn(),
    createPayout: vi.fn().mockResolvedValue({ payout: payout(), replayed: false }),
    confirmPayout: vi
      .fn()
      .mockResolvedValue(payout({ status: "confirmed", confirmationKind: "vendor" })),
    cancelPayout: vi.fn().mockResolvedValue(payout({ status: "cancelled" })),
    createAdjustment: vi.fn().mockResolvedValue(entry()),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const events = { publish: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn() };
  const clock: Clock = { now: () => 1_700_000_000_000 };
  const service = new VendorPayoutsService(
    repo as unknown as VendorPayoutsRepositoryPort,
    audit as unknown as VendorPayoutsAuditPort,
    events as unknown as EventBusPort,
    clock,
  );
  return { service, repo, audit, events };
}

async function expectStatus(promise: Promise<unknown>, status: number): Promise<void> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).getStatus()).toBe(status);
}

describe("VendorPayoutsService — company side", () => {
  let h: ReturnType<typeof makeService>;
  beforeEach(() => {
    h = makeService();
  });

  it("lists every vendor's balance for staff", async () => {
    expect(await h.service.listVendors(principal)).toEqual([balance()]);
    expect(h.repo.listVendorBalances).toHaveBeenCalledWith(COMPANY, USER);
  });

  it("refuses a vendor on the company routes", async () => {
    h.repo.findMemberScope.mockResolvedValueOnce({ warehouseId: WAREHOUSE });
    await expectStatus(h.service.listVendors(principal), 403);
  });

  it("refuses a caller who is not a member", async () => {
    h.repo.findMemberScope.mockResolvedValueOnce(null);
    await expectStatus(h.service.listVendors(principal), 403);
  });

  it("requires an active company", async () => {
    const noTenant = { userId: USER, companyId: null } as unknown as RequestPrincipal;
    await expectStatus(h.service.listVendors(noTenant), 403);
  });

  it("404s an unknown vendor", async () => {
    h.repo.getVendorBalance.mockResolvedValueOnce(null);
    await expectStatus(h.service.getVendor(principal, WAREHOUSE), 404);
  });

  it("returns one vendor's balance", async () => {
    expect(await h.service.getVendor(principal, WAREHOUSE)).toEqual(balance());
  });

  it("passes paging through to the ledger and payouts reads", async () => {
    await h.service.listVendorLedger(principal, WAREHOUSE, { limit: "10", cursor: "c" });
    expect(h.repo.listLedger).toHaveBeenCalledWith(COMPANY, USER, WAREHOUSE, {
      limit: 10,
      cursor: "c",
    });
    await h.service.listCompanyPayouts(principal, undefined, {});
    expect(h.repo.listPayouts).toHaveBeenCalledWith(COMPANY, USER, null, {});
    await h.service.listCompanyPayouts(principal, WAREHOUSE, {});
    expect(h.repo.listPayouts).toHaveBeenLastCalledWith(COMPANY, USER, WAREHOUSE, {});
  });

  it("maps a malformed cursor to 400", async () => {
    h.repo.listLedger.mockRejectedValueOnce(new InvalidCursorError());
    await expectStatus(h.service.listVendorLedger(principal, WAREHOUSE, { cursor: "x" }), 400);
  });

  describe("requestPayout", () => {
    const command = { method: "instapay", idempotencyKey: "key-1" };

    it("creates the payout, audits it and tells the vendor", async () => {
      const result = await h.service.requestPayout(principal, WAREHOUSE, {
        ...command,
        reference: "TX-9",
      });
      expect(result.replayed).toBe(false);
      expect(h.repo.createPayout).toHaveBeenCalledWith(
        { companyId: COMPANY, actorId: USER },
        {
          warehouseId: WAREHOUSE,
          method: "instapay",
          reference: "TX-9",
          notes: null,
          idempotencyKey: "key-1",
        },
      );
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "vendor_payout.requested",
          entityId: PAYOUT,
          changes: {
            warehouseId: WAREHOUSE,
            amountMinor: 18000,
            method: "instapay",
            entryCount: 2,
          },
        }),
      );
      expect(h.events.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "vendor_payout.requested",
          payload: { payoutId: PAYOUT, warehouseId: WAREHOUSE, amountMinor: 18000 },
        }),
      );
    });

    it("replays without auditing or notifying twice", async () => {
      h.repo.createPayout.mockResolvedValueOnce({ payout: payout(), replayed: true });
      const result = await h.service.requestPayout(principal, WAREHOUSE, command);
      expect(result.replayed).toBe(true);
      expect(h.audit.record).not.toHaveBeenCalled();
      expect(h.events.publish).not.toHaveBeenCalled();
    });

    it.each([undefined, "", "   ", "k".repeat(201)])(
      "requires a usable Idempotency-Key (%s)",
      async (idempotencyKey) => {
        await expectStatus(
          h.service.requestPayout(principal, WAREHOUSE, { method: "cash", idempotencyKey }),
          400,
        );
        expect(h.repo.createPayout).not.toHaveBeenCalled();
      },
    );

    it("rejects an unknown method", async () => {
      await expectStatus(
        h.service.requestPayout(principal, WAREHOUSE, { method: "cheque", idempotencyKey: "k" }),
        400,
      );
    });

    it.each([
      [new VendorNotFoundError(), 404],
      [new NothingToPayError(0), 422],
      [new NothingToPayError(-500), 422],
      [new PayoutAlreadyPendingError(), 409],
      [new IdempotencyKeyReusedError(), 409],
    ] as const)("maps %s to %d", async (error, status) => {
      h.repo.createPayout.mockRejectedValueOnce(error);
      await expectStatus(h.service.requestPayout(principal, WAREHOUSE, command), status);
    });

    it("lets an unexpected error through unchanged", async () => {
      const boom = new Error("db down");
      h.repo.createPayout.mockRejectedValueOnce(boom);
      await expect(h.service.requestPayout(principal, WAREHOUSE, command)).rejects.toBe(boom);
    });
  });

  it("cancels a payout, audits it and tells the vendor", async () => {
    const result = await h.service.cancelPayout(principal, PAYOUT);
    expect(result.status).toBe("cancelled");
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "vendor_payout.cancelled" }),
    );
    expect(h.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "vendor_payout.cancelled",
        payload: { payoutId: PAYOUT, warehouseId: WAREHOUSE },
      }),
    );
  });

  it.each([
    [new PayoutNotFoundError(), 404],
    [new PayoutNotPendingError("confirmed"), 409],
  ] as const)("maps a cancel failure %s to %d", async (error, status) => {
    h.repo.cancelPayout.mockRejectedValueOnce(error);
    await expectStatus(h.service.cancelPayout(principal, PAYOUT), status);
  });

  it("force-confirms with a trimmed reason and records it as forced", async () => {
    h.repo.confirmPayout.mockResolvedValueOnce(
      payout({ status: "confirmed", confirmationKind: "forced", forceReason: "on the phone" }),
    );
    await h.service.forceConfirmPayout(principal, PAYOUT, "  on the phone  ");
    expect(h.repo.confirmPayout).toHaveBeenCalledWith(
      { companyId: COMPANY, actorId: USER },
      PAYOUT,
      {
        kind: "forced",
        reason: "on the phone",
      },
    );
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "vendor_payout.confirmed",
        changes: expect.objectContaining({ confirmationKind: "forced", forceReasonLength: 12 }),
      }),
    );
    expect(h.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "vendor_payout.confirmed",
        payload: expect.objectContaining({ confirmationKind: "forced" }),
      }),
    );
  });

  it("requires a real reason to force a confirmation", async () => {
    await expectStatus(h.service.forceConfirmPayout(principal, PAYOUT, "  x "), 400);
    expect(h.repo.confirmPayout).not.toHaveBeenCalled();
  });

  it("maps a closed accounting period to 422", async () => {
    h.repo.confirmPayout.mockRejectedValueOnce(new PayoutPeriodClosedError("2026-11"));
    await expectStatus(h.service.forceConfirmPayout(principal, PAYOUT, "phone call"), 422);
  });

  describe("createAdjustment", () => {
    it("posts a signed correction with a trimmed note and audits only its length", async () => {
      const result = await h.service.createAdjustment(principal, WAREHOUSE, {
        amountMinor: -500,
        note: "  exchange  ",
      });
      expect(result.amountMinor).toBe(-500);
      expect(h.repo.createAdjustment).toHaveBeenCalledWith(
        { companyId: COMPANY, actorId: USER },
        { warehouseId: WAREHOUSE, amountMinor: -500, note: "exchange" },
      );
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "vendor_ledger.adjusted",
          changes: { warehouseId: WAREHOUSE, amountMinor: -500, noteLength: 8 },
        }),
      );
    });

    it.each([0, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects amount %s", async (amountMinor) => {
      await expectStatus(
        h.service.createAdjustment(principal, WAREHOUSE, { amountMinor, note: "fine note" }),
        400,
      );
    });

    it("rejects a note that is too short", async () => {
      await expectStatus(
        h.service.createAdjustment(principal, WAREHOUSE, { amountMinor: 100, note: " a " }),
        400,
      );
    });

    it("404s an adjustment for an unknown vendor", async () => {
      h.repo.createAdjustment.mockRejectedValueOnce(new VendorNotFoundError());
      await expectStatus(
        h.service.createAdjustment(principal, WAREHOUSE, { amountMinor: 100, note: "fine note" }),
        404,
      );
    });
  });
});

describe("VendorPayoutsService — vendor side", () => {
  let h: ReturnType<typeof makeService>;
  beforeEach(() => {
    h = makeService();
    h.repo.findMemberScope.mockResolvedValue({ warehouseId: WAREHOUSE });
  });

  it("reads the vendor's own account by their membership, never the request", async () => {
    await h.service.getMyAccount(principal);
    expect(h.repo.getVendorBalance).toHaveBeenCalledWith(COMPANY, USER, WAREHOUSE);
    await h.service.listMyLedger(principal, { limit: "5" });
    expect(h.repo.listLedger).toHaveBeenCalledWith(COMPANY, USER, WAREHOUSE, { limit: 5 });
    await h.service.listMyPayouts(principal, {});
    expect(h.repo.listPayouts).toHaveBeenCalledWith(COMPANY, USER, WAREHOUSE, {});
  });

  it("404s staff (no warehouse scope) on the vendor routes", async () => {
    h.repo.findMemberScope.mockResolvedValue({ warehouseId: null });
    await expectStatus(h.service.getMyAccount(principal), 404);
    h.repo.findMemberScope.mockResolvedValue(null);
    await expectStatus(h.service.listMyLedger(principal, {}), 404);
  });

  it("404s when the vendor's warehouse is no longer a vendor warehouse", async () => {
    h.repo.getVendorBalance.mockResolvedValueOnce(null);
    await expectStatus(h.service.getMyAccount(principal), 404);
  });

  it("confirms the vendor's own payout, scoped to their warehouse", async () => {
    const result = await h.service.confirmMyPayout(principal, PAYOUT);
    expect(result.status).toBe("confirmed");
    expect(h.repo.confirmPayout).toHaveBeenCalledWith(
      { companyId: COMPANY, actorId: USER },
      PAYOUT,
      {
        kind: "vendor",
        warehouseId: WAREHOUSE,
      },
    );
    expect(h.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "vendor_payout.confirmed",
        payload: expect.objectContaining({ confirmationKind: "vendor", amountMinor: 18000 }),
      }),
    );
  });

  it("treats a missing confirmation kind as the vendor's own", async () => {
    h.repo.confirmPayout.mockResolvedValueOnce(payout({ status: "confirmed" }));
    await h.service.confirmMyPayout(principal, PAYOUT);
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({ confirmationKind: "vendor", forceReasonLength: 0 }),
      }),
    );
  });

  it("404s another vendor's payout and 409s a settled one", async () => {
    h.repo.confirmPayout.mockRejectedValueOnce(new PayoutNotFoundError());
    await expectStatus(h.service.confirmMyPayout(principal, PAYOUT), 404);
    h.repo.confirmPayout.mockRejectedValueOnce(new PayoutNotPendingError("confirmed"));
    await expectStatus(h.service.confirmMyPayout(principal, PAYOUT), 409);
  });
});
