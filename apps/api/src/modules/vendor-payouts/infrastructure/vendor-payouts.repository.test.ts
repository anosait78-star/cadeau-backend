import { describe, expect, it, vi } from "vitest";
import { encodeCursor, InvalidCursorError, Prisma, type PrismaClient } from "@cadeau/database";
import {
  IdempotencyKeyReusedError,
  NothingToPayError,
  PayoutAlreadyPendingError,
  PayoutNotFoundError,
  PayoutNotPendingError,
  PayoutPeriodClosedError,
  VendorNotFoundError,
} from "../domain/vendor-payouts.errors";
import { VendorPayoutsRepository } from "./vendor-payouts.repository";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const WAREHOUSE = "33333333-3333-3333-3333-333333333333";
const PAYOUT = "44444444-4444-4444-4444-444444444444";
const NOW = new Date("2026-11-17T10:00:00.000Z");

const actor = { companyId: COMPANY, actorId: USER };

function payoutRow(extra: Record<string, unknown> = {}) {
  return {
    id: PAYOUT,
    warehouseId: WAREHOUSE,
    amountMinor: 18000n,
    method: "instapay",
    reference: null,
    notes: null,
    status: "pending",
    confirmationKind: null,
    forceReason: null,
    confirmedAt: null,
    cancelledAt: null,
    createdAt: NOW,
    warehouse: { name: "Vendor A" },
    _count: { entries: 2 },
    ...extra,
  };
}

function entryRow(extra: Record<string, unknown> = {}) {
  return {
    id: "e1",
    kind: "accrual",
    orderId: "o1",
    variantId: "v1",
    nameSnapshot: "Mug — Red",
    quantity: 2n,
    unitCostMinor: 9000n,
    amountMinor: 18000n,
    needsPricing: false,
    payoutId: null,
    note: null,
    createdAt: NOW,
    order: { orderNumber: 1042n },
    payout: null,
    ...extra,
  };
}

function delegate() {
  return {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findFirstOrThrow: vi.fn().mockResolvedValue(payoutRow()),
    create: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    groupBy: vi.fn().mockResolvedValue([]),
  };
}

function makeRepo(state: { open?: { id: string; amount_minor: bigint }[]; period?: string } = {}) {
  const models = {
    companyMember: delegate(),
    warehouse: delegate(),
    vendorLedgerEntry: delegate(),
    vendorPayout: delegate(),
  };
  const queryRaw = vi.fn((strings: TemplateStringsArray) => {
    const sql = strings.join(" ");
    if (sql.includes("vendor_ledger_entries")) return Promise.resolve(state.open ?? []);
    if (sql.includes("accounting_periods")) {
      return Promise.resolve(state.period === undefined ? [] : [{ status: state.period }]);
    }
    return Promise.resolve([]); // set_config
  });
  const txHost = { $queryRaw: queryRaw, ...models };
  const prisma = { $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(txHost)) };
  const repo = new VendorPayoutsRepository(prisma as unknown as PrismaClient);
  return { repo, models, queryRaw, prisma };
}

function uniqueViolation(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "6",
    meta: { target },
  });
}

describe("VendorPayoutsRepository — context", () => {
  it("binds both the tenant and the acting user on every transaction", async () => {
    const { repo, queryRaw } = makeRepo();
    await repo.findMemberScope(COMPANY, USER);
    const configs = queryRaw.mock.calls.map((call) => (call[0] as readonly string[]).join("?"));
    expect(configs.some((sql) => sql.includes("app.company_id"))).toBe(true);
    expect(configs.some((sql) => sql.includes("app.user_id"))).toBe(true);
  });

  it("returns the member's warehouse scope, or null for a non-member", async () => {
    const { repo, models } = makeRepo();
    models.companyMember.findFirst.mockResolvedValueOnce({ warehouseId: WAREHOUSE });
    expect(await repo.findMemberScope(COMPANY, USER)).toEqual({ warehouseId: WAREHOUSE });
    expect(await repo.findMemberScope(COMPANY, USER)).toBeNull();
  });
});

describe("VendorPayoutsRepository — balances", () => {
  it("combines open, unpriced, pending and paid figures per vendor warehouse", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.findMany.mockResolvedValueOnce([
      { id: "wa", name: "A", vendorMembers: [{ user: { fullName: null, email: "a@x.test" } }] },
      { id: "wb", name: "B", vendorMembers: [] },
    ]);
    models.vendorLedgerEntry.groupBy
      .mockResolvedValueOnce([
        { warehouseId: "wa", _sum: { amountMinor: 18000n } },
        { warehouseId: "wb", _sum: { amountMinor: null } },
      ])
      .mockResolvedValueOnce([{ warehouseId: "wa", _count: { _all: 3 } }]);
    models.vendorPayout.findMany.mockResolvedValueOnce([
      { id: PAYOUT, warehouseId: "wa", amountMinor: 5000n },
    ]);
    models.vendorPayout.groupBy.mockResolvedValueOnce([
      { warehouseId: "wa", _sum: { amountMinor: 40000n } },
      { warehouseId: "wb", _sum: { amountMinor: null } },
    ]);

    const balances = await repo.listVendorBalances(COMPANY, USER);
    expect(balances).toEqual([
      {
        warehouseId: "wa",
        warehouseName: "A",
        vendorName: "a@x.test",
        owedMinor: 18000,
        pendingMinor: 5000,
        paidMinor: 40000,
        needsPricingCount: 3,
        pendingPayoutId: PAYOUT,
      },
      {
        warehouseId: "wb",
        warehouseName: "B",
        vendorName: null,
        owedMinor: 0,
        pendingMinor: 0,
        paidMinor: 0,
        needsPricingCount: 0,
        pendingPayoutId: null,
      },
    ]);
    const where = models.warehouse.findMany.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where["OR"]).toEqual([
      { vendorMappings: { some: {} } },
      { vendorMembers: { some: {} } },
    ]);
    expect(models.vendorLedgerEntry.groupBy.mock.calls[0]![0].where).toEqual({
      companyId: COMPANY,
      payoutId: null,
      needsPricing: false,
    });
  });

  it("narrows to one warehouse, prefers a full name, and is null when it is not a vendor's", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.findMany.mockResolvedValueOnce([
      { id: WAREHOUSE, name: "A", vendorMembers: [{ user: { fullName: "Ali", email: "a@x" } }] },
    ]);
    const balance = await repo.getVendorBalance(COMPANY, USER, WAREHOUSE);
    expect(balance?.vendorName).toBe("Ali");
    expect(models.warehouse.findMany.mock.calls[0]![0].where).toMatchObject({ id: WAREHOUSE });
    expect(models.vendorPayout.findMany.mock.calls[0]![0].where).toEqual({
      companyId: COMPANY,
      warehouseId: WAREHOUSE,
      status: "pending",
    });

    models.warehouse.findMany.mockResolvedValueOnce([]);
    expect(await repo.getVendorBalance(COMPANY, USER, WAREHOUSE)).toBeNull();
  });
});

describe("VendorPayoutsRepository — statement and payout lists", () => {
  it("maps ledger rows, deriving each row's state from its payout", async () => {
    const { repo, models } = makeRepo();
    models.vendorLedgerEntry.findMany.mockResolvedValueOnce([
      entryRow(),
      entryRow({ id: "e2", payoutId: PAYOUT, payout: { status: "pending" } }),
      entryRow({
        id: "e3",
        kind: "adjustment",
        orderId: null,
        order: null,
        variantId: null,
        nameSnapshot: null,
        quantity: null,
        unitCostMinor: null,
        amountMinor: -500n,
        note: "exchange",
        payoutId: PAYOUT,
        payout: { status: "confirmed" },
      }),
    ]);
    const page = await repo.listLedger(COMPANY, USER, WAREHOUSE, {});
    expect(page.data.map((e) => e.state)).toEqual(["open", "pending", "settled"]);
    expect(page.data[0]).toMatchObject({ orderNumber: 1042, quantity: 2, amountMinor: 18000 });
    expect(page.data[2]).toMatchObject({
      orderNumber: null,
      quantity: null,
      unitCostMinor: null,
      amountMinor: -500,
      note: "exchange",
    });
    expect(page.page.hasMore).toBe(false);
  });

  it("applies a newest-first keyset cursor and reports more pages", async () => {
    const { repo, models } = makeRepo();
    models.vendorLedgerEntry.findMany.mockResolvedValueOnce([
      entryRow({ id: "e1" }),
      entryRow({ id: "e2" }),
    ]);
    const cursor = encodeCursor({ p: NOW.toISOString(), t: "e9" });
    const page = await repo.listLedger(COMPANY, USER, WAREHOUSE, { limit: 1, cursor });
    const args = models.vendorLedgerEntry.findMany.mock.calls[0]![0];
    expect(args.take).toBe(2);
    expect(args.where.OR).toEqual([
      { createdAt: { lt: NOW } },
      { AND: [{ createdAt: NOW }, { id: { lt: "e9" } }] },
    ]);
    expect(page.page.hasMore).toBe(true);
    expect(page.data).toHaveLength(1);
  });

  it("rejects a cursor whose values are not strings", async () => {
    const { repo } = makeRepo();
    await expect(
      repo.listLedger(COMPANY, USER, WAREHOUSE, { cursor: encodeCursor({ p: 1, t: 2 }) }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });

  it("lists the whole company's payouts or one vendor's", async () => {
    const { repo, models } = makeRepo();
    models.vendorPayout.findMany.mockResolvedValue([
      payoutRow({
        status: "confirmed",
        confirmationKind: "forced",
        forceReason: "phone",
        confirmedAt: NOW,
      }),
    ]);
    const all = await repo.listPayouts(COMPANY, USER, null, {});
    expect(models.vendorPayout.findMany.mock.calls[0]![0].where).toEqual({ companyId: COMPANY });
    expect(all.data[0]).toMatchObject({
      amountMinor: 18000,
      warehouseName: "Vendor A",
      entryCount: 2,
      confirmedAt: NOW.toISOString(),
      cancelledAt: null,
    });
    await repo.listPayouts(COMPANY, USER, WAREHOUSE, {});
    expect(models.vendorPayout.findMany.mock.calls[1]![0].where).toEqual({
      companyId: COMPANY,
      warehouseId: WAREHOUSE,
    });
  });

  it("finds one payout or returns null", async () => {
    const { repo, models } = makeRepo();
    models.vendorPayout.findFirst.mockResolvedValueOnce(payoutRow({ cancelledAt: NOW }));
    expect((await repo.findPayout(COMPANY, USER, PAYOUT))?.cancelledAt).toBe(NOW.toISOString());
    expect(await repo.findPayout(COMPANY, USER, PAYOUT)).toBeNull();
  });
});

describe("VendorPayoutsRepository — createPayout", () => {
  const input = { warehouseId: WAREHOUSE, method: "instapay" as const, idempotencyKey: "k1" };

  it("pays exactly the open priced rows it locked, linking them to the new payout", async () => {
    const { repo, models, queryRaw } = makeRepo({
      open: [
        { id: "e1", amount_minor: 18000n },
        { id: "e2", amount_minor: -3000n },
      ],
    });
    models.warehouse.findFirst.mockResolvedValueOnce({ id: WAREHOUSE });
    models.vendorPayout.create.mockResolvedValueOnce({ id: PAYOUT });
    models.vendorPayout.findFirstOrThrow.mockResolvedValueOnce(payoutRow({ amountMinor: 15000n }));

    const { payout, replayed } = await repo.createPayout(actor, { ...input, notes: "July" });
    expect(replayed).toBe(false);
    expect(payout.amountMinor).toBe(15000);

    const lock = queryRaw.mock.calls
      .map((call) => (call[0] as readonly string[]).join("?"))
      .find((sql) => sql.includes("vendor_ledger_entries"));
    expect(lock).toContain("FOR UPDATE");
    expect(lock).toContain("payout_id IS NULL");
    expect(lock).toContain("NOT needs_pricing");
    expect(models.vendorPayout.create.mock.calls[0]![0].data).toMatchObject({
      companyId: COMPANY,
      warehouseId: WAREHOUSE,
      amountMinor: 15000n,
      method: "instapay",
      reference: null,
      notes: "July",
      idempotencyKey: "k1",
      createdBy: USER,
    });
    expect(models.vendorLedgerEntry.updateMany.mock.calls[0]![0]).toEqual({
      where: { id: { in: ["e1", "e2"] }, companyId: COMPANY },
      data: { payoutId: PAYOUT, updatedBy: USER },
    });
  });

  it("replays an already-used key for the same vendor without writing", async () => {
    const { repo, models } = makeRepo();
    models.vendorPayout.findFirst.mockResolvedValueOnce(payoutRow());
    const result = await repo.createPayout(actor, input);
    expect(result.replayed).toBe(true);
    expect(models.vendorPayout.create).not.toHaveBeenCalled();
  });

  it("refuses a key already used for another vendor", async () => {
    const { repo, models } = makeRepo();
    models.vendorPayout.findFirst.mockResolvedValueOnce(payoutRow({ warehouseId: "other" }));
    await expect(repo.createPayout(actor, input)).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  });

  it("refuses a warehouse that is not a vendor's", async () => {
    const { repo } = makeRepo();
    await expect(repo.createPayout(actor, input)).rejects.toBeInstanceOf(VendorNotFoundError);
  });

  it("refuses while another payout is pending", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.findFirst.mockResolvedValueOnce({ id: WAREHOUSE });
    models.vendorPayout.findFirst
      .mockResolvedValueOnce(null) // idempotency replay lookup
      .mockResolvedValueOnce({ id: "pending" });
    await expect(repo.createPayout(actor, input)).rejects.toBeInstanceOf(PayoutAlreadyPendingError);
  });

  it.each([[[]], [[{ id: "e1", amount_minor: -500n }]]])(
    "refuses when nothing is owed (case %#)",
    async (open) => {
      const { repo, models } = makeRepo({ open });
      models.warehouse.findFirst.mockResolvedValueOnce({ id: WAREHOUSE });
      await expect(repo.createPayout(actor, input)).rejects.toBeInstanceOf(NothingToPayError);
      expect(models.vendorPayout.create).not.toHaveBeenCalled();
    },
  );

  it("replays in a fresh transaction when the same key raced it", async () => {
    const { repo, models, prisma } = makeRepo({ open: [{ id: "e1", amount_minor: 100n }] });
    models.warehouse.findFirst.mockResolvedValueOnce({ id: WAREHOUSE });
    models.vendorPayout.create.mockRejectedValueOnce(
      uniqueViolation("vendor_payouts_idempotency_key"),
    );
    models.vendorPayout.findFirst
      .mockResolvedValueOnce(null) // first replay lookup
      .mockResolvedValueOnce(null) // pending check
      .mockResolvedValueOnce(payoutRow()); // replay in the fresh transaction
    const result = await repo.createPayout(actor, input);
    expect(result.replayed).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("reports a pending conflict when the raced key cannot be replayed", async () => {
    const { repo, models } = makeRepo({ open: [{ id: "e1", amount_minor: 100n }] });
    models.warehouse.findFirst.mockResolvedValueOnce({ id: WAREHOUSE });
    models.vendorPayout.create.mockRejectedValueOnce(uniqueViolation("idempotency_key"));
    await expect(repo.createPayout(actor, input)).rejects.toBeInstanceOf(PayoutAlreadyPendingError);
  });

  it("maps a race on the one-pending index to a pending conflict", async () => {
    const { repo, models } = makeRepo({ open: [{ id: "e1", amount_minor: 100n }] });
    models.warehouse.findFirst.mockResolvedValueOnce({ id: WAREHOUSE });
    models.vendorPayout.create.mockRejectedValueOnce(
      uniqueViolation("vendor_payouts_one_pending_idx"),
    );
    await expect(repo.createPayout(actor, input)).rejects.toBeInstanceOf(PayoutAlreadyPendingError);
  });

  it("lets any other write error through", async () => {
    const { repo, models } = makeRepo({ open: [{ id: "e1", amount_minor: 100n }] });
    models.warehouse.findFirst.mockResolvedValueOnce({ id: WAREHOUSE });
    const boom = new Error("connection reset");
    models.vendorPayout.create.mockRejectedValueOnce(boom);
    await expect(repo.createPayout(actor, input)).rejects.toBe(boom);
  });
});

describe("VendorPayoutsRepository — confirm, cancel, adjust", () => {
  it("confirms the vendor's own pending payout", async () => {
    const { repo, models } = makeRepo();
    models.vendorPayout.findFirst.mockResolvedValueOnce({
      warehouseId: WAREHOUSE,
      status: "pending",
    });
    models.vendorPayout.findFirstOrThrow.mockResolvedValueOnce(
      payoutRow({ status: "confirmed", confirmationKind: "vendor", confirmedAt: NOW }),
    );
    const result = await repo.confirmPayout(actor, PAYOUT, {
      kind: "vendor",
      warehouseId: WAREHOUSE,
    });
    expect(result.status).toBe("confirmed");
    const call = models.vendorPayout.updateMany.mock.calls[0]![0];
    expect(call.where).toEqual({ id: PAYOUT, companyId: COMPANY, status: "pending" });
    expect(call.data).toMatchObject({
      status: "confirmed",
      confirmationKind: "vendor",
      forceReason: null,
      confirmedBy: USER,
    });
    expect(call.data.confirmedAt).toBeInstanceOf(Date);
  });

  it("records a forced confirmation with its reason", async () => {
    const { repo, models } = makeRepo();
    models.vendorPayout.findFirst.mockResolvedValueOnce({
      warehouseId: WAREHOUSE,
      status: "pending",
    });
    await repo.confirmPayout(actor, PAYOUT, { kind: "forced", reason: "phone call" });
    expect(models.vendorPayout.updateMany.mock.calls[0]![0].data).toMatchObject({
      confirmationKind: "forced",
      forceReason: "phone call",
    });
  });

  it("hides another vendor's payout behind not-found", async () => {
    const { repo, models } = makeRepo();
    models.vendorPayout.findFirst.mockResolvedValueOnce({
      warehouseId: "other",
      status: "pending",
    });
    await expect(
      repo.confirmPayout(actor, PAYOUT, { kind: "vendor", warehouseId: WAREHOUSE }),
    ).rejects.toBeInstanceOf(PayoutNotFoundError);
    expect(models.vendorPayout.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an absent payout and a settled one", async () => {
    const { repo, models } = makeRepo();
    await expect(
      repo.confirmPayout(actor, PAYOUT, { kind: "forced", reason: "phone" }),
    ).rejects.toBeInstanceOf(PayoutNotFoundError);
    models.vendorPayout.findFirst.mockResolvedValueOnce({
      warehouseId: WAREHOUSE,
      status: "confirmed",
    });
    await expect(
      repo.confirmPayout(actor, PAYOUT, { kind: "forced", reason: "phone" }),
    ).rejects.toBeInstanceOf(PayoutNotPendingError);
  });

  it("refuses when a concurrent change already moved the payout", async () => {
    const { repo, models } = makeRepo();
    models.vendorPayout.findFirst.mockResolvedValueOnce({
      warehouseId: WAREHOUSE,
      status: "pending",
    });
    models.vendorPayout.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      repo.confirmPayout(actor, PAYOUT, { kind: "forced", reason: "phone" }),
    ).rejects.toBeInstanceOf(PayoutNotPendingError);
  });

  it("refuses to confirm inside a closed accounting period", async () => {
    const { repo, models } = makeRepo({ period: "closed" });
    await expect(
      repo.confirmPayout(actor, PAYOUT, { kind: "forced", reason: "phone" }),
    ).rejects.toBeInstanceOf(PayoutPeriodClosedError);
    expect(models.vendorPayout.findFirst).not.toHaveBeenCalled();
  });

  it("confirms inside an open accounting period", async () => {
    const { repo, models } = makeRepo({ period: "open" });
    models.vendorPayout.findFirst.mockResolvedValueOnce({
      warehouseId: WAREHOUSE,
      status: "pending",
    });
    await expect(
      repo.confirmPayout(actor, PAYOUT, { kind: "forced", reason: "phone" }),
    ).resolves.toBeDefined();
  });

  it("cancels a pending payout and releases its rows", async () => {
    const { repo, models } = makeRepo();
    models.vendorPayout.findFirst.mockResolvedValueOnce({
      warehouseId: WAREHOUSE,
      status: "pending",
    });
    models.vendorPayout.findFirstOrThrow.mockResolvedValueOnce(
      payoutRow({ status: "cancelled", cancelledAt: NOW, _count: { entries: 0 } }),
    );
    const result = await repo.cancelPayout(actor, PAYOUT);
    expect(result.status).toBe("cancelled");
    expect(models.vendorPayout.updateMany.mock.calls[0]![0].data).toMatchObject({
      status: "cancelled",
      cancelledBy: USER,
    });
    expect(models.vendorLedgerEntry.updateMany.mock.calls[0]![0]).toEqual({
      where: { payoutId: PAYOUT, companyId: COMPANY },
      data: { payoutId: null, updatedBy: USER },
    });
  });

  it("refuses to cancel when a concurrent change already moved the payout", async () => {
    const { repo, models } = makeRepo();
    models.vendorPayout.findFirst.mockResolvedValueOnce({
      warehouseId: WAREHOUSE,
      status: "pending",
    });
    models.vendorPayout.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(repo.cancelPayout(actor, PAYOUT)).rejects.toBeInstanceOf(PayoutNotPendingError);
    expect(models.vendorLedgerEntry.updateMany).not.toHaveBeenCalled();
  });

  it("posts an adjustment on a vendor's account", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.findFirst.mockResolvedValueOnce({ id: WAREHOUSE });
    models.vendorLedgerEntry.create.mockResolvedValueOnce(
      entryRow({
        id: "adj",
        kind: "adjustment",
        orderId: null,
        order: null,
        quantity: null,
        unitCostMinor: null,
        amountMinor: 2500n,
        note: "opening balance",
      }),
    );
    const view = await repo.createAdjustment(actor, {
      warehouseId: WAREHOUSE,
      amountMinor: 2500,
      note: "opening balance",
    });
    expect(view).toMatchObject({ kind: "adjustment", amountMinor: 2500, state: "open" });
    expect(models.vendorLedgerEntry.create.mock.calls[0]![0].data).toMatchObject({
      companyId: COMPANY,
      warehouseId: WAREHOUSE,
      kind: "adjustment",
      amountMinor: 2500n,
      note: "opening balance",
      createdBy: USER,
    });
  });

  it("refuses an adjustment for a warehouse that is not a vendor's", async () => {
    const { repo } = makeRepo();
    await expect(
      repo.createAdjustment(actor, { warehouseId: WAREHOUSE, amountMinor: 1, note: "abc" }),
    ).rejects.toBeInstanceOf(VendorNotFoundError);
  });
});
