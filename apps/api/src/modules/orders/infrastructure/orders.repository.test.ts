import { describe, expect, it, vi } from "vitest";
import { encodeCursor, Prisma, type PrismaClient } from "@cadeau/database";
import {
  IllegalTransitionError,
  InsufficientStockError,
  PaymentStatusMismatchError,
  ReasonRequiredError,
} from "../domain/orders.errors";
import { OrdersRepository } from "./orders.repository";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const CUSTOMER = "44444444-4444-4444-4444-444444444444";
const DATE = new Date("2026-01-02T03:04:05.000Z");

const actor = { companyId: COMPANY, actorId: ACTOR };

function detailRow(extra: Record<string, unknown> = {}) {
  return {
    id: "o1",
    orderNumber: 1042n,
    customerId: CUSTOMER,
    assigneeId: null,
    status: "new",
    followUpState: "none",
    labelId: null,
    reasonId: null,
    governorateId: null,
    warehouseId: null,
    subtotal: 30000n,
    shippingFee: 5000n,
    discount: 0n,
    total: 35000n,
    collectedAmount: 0n,
    paymentStatus: "unpaid",
    statusChangedAt: DATE,
    createdAt: DATE,
    updatedAt: DATE,
    customer: { name: "Sara" },
    _count: { items: 1 },
    notes: null,
    items: [
      {
        id: "i1",
        variantId: "v1",
        nameSnapshot: "T — L",
        quantity: 2n,
        price: 15000n,
        costSnapshot: 8000n,
      },
    ],
    ...extra,
  };
}

function makeRepo() {
  // Configurable state for the FOR UPDATE order lock and the stock level.
  const lock = { status: "new", missing: false, warehouseId: null as string | null };
  const level = { onHand: 10n, committed: 0n };
  const models = {
    order: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findFirstOrThrow: vi.fn().mockResolvedValue(detailRow()),
      create: vi.fn().mockResolvedValue({ id: "o1" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      groupBy: vi.fn().mockResolvedValue([{ status: "new", _count: { _all: 3 } }]),
      aggregate: vi.fn().mockResolvedValue({
        _count: { _all: 1 },
        _sum: { collectedAmount: 0n },
        _max: { createdAt: DATE },
      }),
    },
    orderItem: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([{ variantId: "v1", quantity: 2n }]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    orderActivity: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    orderVendorGroup: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findFirstOrThrow: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    customer: {
      findFirst: vi.fn().mockResolvedValue({ id: CUSTOMER }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    productVariant: {
      findFirst: vi.fn().mockResolvedValue({
        id: "v1",
        name: "L",
        averageCost: 8000n,
        product: { name: "T", allowOversell: false },
      }),
    },
    orderLabel: { findFirst: vi.fn().mockResolvedValue({ id: "l1" }) },
    orderReason: { findFirst: vi.fn().mockResolvedValue({ id: "r1" }) },
    governorate: { findFirst: vi.fn().mockResolvedValue({ id: "g1" }) },
    companyMember: {
      findFirst: vi.fn().mockResolvedValue({ id: "m1" }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    warehouse: {
      findFirst: vi.fn().mockResolvedValue({ id: "w1" }),
      findMany: vi.fn().mockResolvedValue([{ id: "w1" }]),
    },
    inventoryStock: {
      upsert: vi.fn().mockResolvedValue({ id: "lvl1" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    stockReservation: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: "res1", warehouseId: "w1", variantId: "v1", quantity: 2n }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const queryRaw = vi.fn((strings: TemplateStringsArray) => {
    const sql = strings.join(" ");
    if (sql.includes("order_sequences")) return Promise.resolve([{ next_number: 2n }]);
    if (sql.includes("FROM public.orders")) {
      return Promise.resolve(
        lock.missing
          ? []
          : [
              {
                id: "o1",
                status: lock.status,
                customer_id: CUSTOMER,
                warehouse_id: lock.warehouseId,
              },
            ],
      );
    }
    if (sql.includes("inventory_stock")) {
      return Promise.resolve([{ id: "lvl1", on_hand: level.onHand, committed: level.committed }]);
    }
    return Promise.resolve([]);
  });
  const txHost = { $queryRaw: queryRaw, ...models };
  const prisma = { $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(txHost)) };
  const repo = new OrdersRepository(prisma as unknown as PrismaClient);
  return { repo, models, queryRaw, lock, level };
}

const CREATE = {
  customerId: CUSTOMER,
  items: [{ variantId: "v1", quantity: 2, price: 15000 }],
  shippingFee: 5000,
};

describe("OrdersRepository — create", () => {
  it("issues a per-company number, freezes the cost snapshot, and computes money", async () => {
    const { repo, models, queryRaw } = makeRepo();
    const { order } = await repo.create(actor, CREATE);

    // Number issued from the sequence (next=2 ⇒ used 1042 from detailRow, issued value = 1).
    expect(queryRaw).toHaveBeenCalled();
    const orderData = models.order.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(orderData["orderNumber"]).toBe(1n);
    expect(orderData["subtotal"]).toBe(30000n); // 2 × 15000
    expect(orderData["total"]).toBe(35000n); // + 5000 shipping

    // The line freezes the variant's averageCost as the COGS snapshot.
    const itemData = models.orderItem.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(itemData["costSnapshot"]).toBe(8000n);

    // KPIs recomputed for the customer in the same transaction.
    expect(models.customer.updateMany).toHaveBeenCalled();
    expect(order.id).toBe("o1");
  });

  it("rejects an empty order", async () => {
    const { repo } = makeRepo();
    await expect(repo.create(actor, { customerId: CUSTOMER, items: [] })).rejects.toBeInstanceOf(
      Error,
    );
  });

  it("replays an existing idempotency key without writing", async () => {
    const { repo, models } = makeRepo();
    models.order.findFirst.mockResolvedValueOnce(detailRow());
    const result = await repo.create(actor, { ...CREATE, idempotencyKey: "k1" });
    expect(result.replayed).toBe(true);
    expect(models.order.create).not.toHaveBeenCalled();
  });

  it("rejects a missing variant reference", async () => {
    const { repo, models } = makeRepo();
    models.productVariant.findFirst.mockResolvedValueOnce(null);
    await expect(repo.create(actor, CREATE)).rejects.toMatchObject({ field: "variantId" });
  });

  it("persists warehouseId, collectedAmount and paymentStatus when supplied", async () => {
    const { repo, models } = makeRepo();
    await repo.create(actor, {
      ...CREATE,
      warehouseId: "w1",
      collectedAmount: 35000,
      paymentStatus: "paid",
    });
    const orderData = models.order.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(orderData["warehouseId"]).toBe("w1");
    expect(orderData["collectedAmount"]).toBe(35000n);
    expect(orderData["paymentStatus"]).toBe("paid");
  });

  it("defaults collectedAmount to 0 and paymentStatus to unpaid when omitted", async () => {
    const { repo, models } = makeRepo();
    await repo.create(actor, CREATE);
    const orderData = models.order.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(orderData["warehouseId"]).toBeNull();
    expect(orderData["collectedAmount"]).toBe(0n);
    expect(orderData["paymentStatus"]).toBe("unpaid");
  });

  it.each([
    ["paid", 100],
    ["unpaid", 100],
    ["partial", 0],
    ["partial", 35000],
  ] as const)(
    "rejects paymentStatus %s with an inconsistent collectedAmount %d",
    async (paymentStatus, collectedAmount) => {
      const { repo } = makeRepo();
      await expect(
        repo.create(actor, { ...CREATE, paymentStatus, collectedAmount }),
      ).rejects.toBeInstanceOf(PaymentStatusMismatchError);
    },
  );

  it("rejects a collectedAmount greater than the order total", async () => {
    const { repo } = makeRepo();
    await expect(repo.create(actor, { ...CREATE, collectedAmount: 99999 })).rejects.toMatchObject({
      field: "collectedAmount",
    });
  });

  it("rejects an unknown warehouseId", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.findFirst.mockResolvedValueOnce(null);
    await expect(repo.create(actor, { ...CREATE, warehouseId: "ghost" })).rejects.toMatchObject({
      field: "warehouseId",
    });
  });
});

describe("OrdersRepository — transition", () => {
  it("reserves stock on new → processing (feature applied)", async () => {
    const { repo, models } = makeRepo();
    const change = await repo.transition(actor, "o1", { toStatus: "processing", applyStock: true });
    expect(change?.fromStatus).toBe("new");
    expect(change?.toStatus).toBe("processing");
    // committed rose and a reservation was written against the order.
    expect(models.inventoryStock.updateMany).toHaveBeenCalled();
    const resData = models.stockReservation.create.mock.calls[0]![0].data as Record<
      string,
      unknown
    >;
    expect(resData["orderId"]).toBe("o1");
    expect(resData["quantity"]).toBe(2n);
    // Activity + KPI recompute happened.
    expect(models.orderActivity.create).toHaveBeenCalled();
    expect(models.customer.updateMany).toHaveBeenCalled();
  });

  it("releases the reservation (no on-hand change) on a pre-ship cancel", async () => {
    const { repo, models, lock, level } = makeRepo();
    lock.status = "processing";
    level.committed = 2n;
    await repo.transition(actor, "o1", {
      toStatus: "cancelled",
      applyStock: true,
      reasonId: "r1",
    });
    const update = models.inventoryStock.updateMany.mock.calls[0]![0].data as Record<
      string,
      unknown
    >;
    expect(update["committed"]).toEqual({ increment: -2n });
    expect(update["onHand"]).toBeUndefined(); // release leaves on-hand alone
  });

  it("skips stock when the feature is not applied", async () => {
    const { repo, models } = makeRepo();
    await repo.transition(actor, "o1", { toStatus: "processing", applyStock: false });
    expect(models.stockReservation.create).not.toHaveBeenCalled();
    expect(models.inventoryStock.updateMany).not.toHaveBeenCalled();
  });

  it("decrements on-hand and releases the reservation on ship", async () => {
    const { repo, models, lock, level } = makeRepo();
    lock.status = "ready";
    level.committed = 2n; // the order's reservation is live
    await repo.transition(actor, "o1", { toStatus: "shipped", applyStock: true });
    const update = models.inventoryStock.updateMany.mock.calls[0]![0].data as Record<
      string,
      unknown
    >;
    expect(update["onHand"]).toEqual({ increment: -2n });
    expect(update["committed"]).toEqual({ increment: -2n });
    expect(models.stockReservation.updateMany).toHaveBeenCalled();
  });

  it("rejects an illegal transition", async () => {
    const { repo } = makeRepo();
    await expect(
      repo.transition(actor, "o1", { toStatus: "delivered", applyStock: false }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it("requires a cancel reason", async () => {
    const { repo, models } = makeRepo();
    models.orderReason.findFirst.mockResolvedValue(null);
    await expect(
      repo.transition(actor, "o1", { toStatus: "cancelled", applyStock: false, reasonId: null }),
    ).rejects.toBeInstanceOf(ReasonRequiredError);
  });

  it("blocks a reservation that would oversell", async () => {
    const { repo, models } = makeRepo();
    models.orderItem.findMany.mockResolvedValue([{ variantId: "v1", quantity: 999n }]);
    await expect(
      repo.transition(actor, "o1", { toStatus: "processing", applyStock: true }),
    ).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it("returns null when the order is absent", async () => {
    const { repo, lock } = makeRepo();
    lock.missing = true;
    const change = await repo.transition(actor, "missing", {
      toStatus: "processing",
      applyStock: false,
    });
    expect(change).toBeNull();
  });

  describe("vendor group activation (Vendor Accounts, Phase 3)", () => {
    it("materializes vendor groups when entering processing, even with stock coupling off", async () => {
      const { repo, models } = makeRepo();
      // First call: applyStockEffect is skipped (applyStock: false), so the
      // ONLY orderItem.findMany call belongs to the materialization step.
      models.orderItem.findMany.mockResolvedValueOnce([
        {
          id: "i1",
          variantId: "v1",
          nameSnapshot: "A",
          quantity: 1n,
          price: 1000n,
          warehouseId: "w1",
        },
        {
          id: "i2",
          variantId: "v2",
          nameSnapshot: "B",
          quantity: 1n,
          price: 1000n,
          warehouseId: "w2",
        },
      ]);
      await repo.transition(actor, "o1", { toStatus: "processing", applyStock: false });
      expect(models.orderVendorGroup.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ orderId: "o1", warehouseId: "w1" }),
            expect.objectContaining({ orderId: "o1", warehouseId: "w2" }),
          ]),
          skipDuplicates: true,
        }),
      );
    });

    it("materializes vendor groups alongside stock coupling when both are on", async () => {
      const { repo, models } = makeRepo();
      models.orderItem.findMany
        .mockResolvedValueOnce([{ variantId: "v1", quantity: 2n, warehouseId: null }]) // applyStockEffect
        .mockResolvedValueOnce([
          {
            id: "i1",
            variantId: "v1",
            nameSnapshot: "A",
            quantity: 2n,
            price: 1000n,
            warehouseId: "w1",
          },
        ]); // materializeVendorGroups
      await repo.transition(actor, "o1", { toStatus: "processing", applyStock: true });
      expect(models.stockReservation.create).toHaveBeenCalled(); // stock coupling still ran
      expect(models.orderVendorGroup.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ orderId: "o1", warehouseId: "w1" })],
        }),
      );
    });

    it("is a no-op for a non-multi-vendor order (no items carry a warehouseId)", async () => {
      const { repo, models } = makeRepo();
      models.orderItem.findMany.mockResolvedValueOnce([]); // materialize's own query finds nothing
      await repo.transition(actor, "o1", { toStatus: "processing", applyStock: false });
      expect(models.orderVendorGroup.createMany).not.toHaveBeenCalled();
    });

    it("does not run for a transition that does not enter processing", async () => {
      const { repo, models } = makeRepo();
      await repo.transition(actor, "o1", { toStatus: "confirming", applyStock: false });
      expect(models.orderVendorGroup.createMany).not.toHaveBeenCalled();
    });
  });

  it("reserves stock against the order's stored warehouseId instead of the default", async () => {
    const { repo, models, lock } = makeRepo();
    lock.warehouseId = "w2";
    await repo.transition(actor, "o1", { toStatus: "processing", applyStock: true });
    const resData = models.stockReservation.create.mock.calls[0]![0].data as Record<
      string,
      unknown
    >;
    expect(resData["warehouseId"]).toBe("w2");
    // The default-warehouse lookup is skipped entirely when the order carries its own.
    expect(models.warehouse.findFirst).not.toHaveBeenCalled();
  });

  // ---- storefront multi-vendor routing (each order item may carry its own warehouseId) ----

  it("reserves each line at its own per-item warehouseId, not the order's single warehouse", async () => {
    const { repo, models, lock } = makeRepo();
    lock.warehouseId = "w-order-default";
    models.orderItem.findMany.mockResolvedValue([
      { variantId: "v1", quantity: 2n, warehouseId: "w-A" },
      { variantId: "v2", quantity: 3n, warehouseId: "w-B" },
    ]);

    await repo.transition(actor, "o1", { toStatus: "processing", applyStock: true });

    expect(models.stockReservation.create).toHaveBeenCalledTimes(2);
    const warehouseIds = models.stockReservation.create.mock.calls.map(
      (call) => (call[0] as { data: Record<string, unknown> }).data["warehouseId"],
    );
    expect(warehouseIds.sort()).toEqual(["w-A", "w-B"]);
    // Neither line used the order's own warehouse — both had their own override.
    expect(warehouseIds).not.toContain("w-order-default");
  });

  it("falls back to the order's single warehouseId for any line with no override — manual/CSV orders are untouched", async () => {
    const { repo, models, lock } = makeRepo();
    lock.warehouseId = "w-order-default";
    // No warehouseId on the item at all — exactly what every non-storefront order looks like.
    models.orderItem.findMany.mockResolvedValue([{ variantId: "v1", quantity: 2n }]);

    await repo.transition(actor, "o1", { toStatus: "processing", applyStock: true });

    const resData = models.stockReservation.create.mock.calls[0]![0].data as Record<
      string,
      unknown
    >;
    expect(resData["warehouseId"]).toBe("w-order-default");
  });

  it("is atomic across warehouses: a shortage on ANY line's warehouse creates NO reservations at all", async () => {
    const { repo, models, level } = makeRepo();
    // Shared mocked stock level is short for the demanded quantity.
    level.onHand = 1n;
    level.committed = 0n;
    models.orderItem.findMany.mockResolvedValue([
      { variantId: "v1", quantity: 2n, warehouseId: "w-A" },
      { variantId: "v2", quantity: 1n, warehouseId: "w-B" },
    ]);

    await expect(
      repo.transition(actor, "o1", { toStatus: "processing", applyStock: true }),
    ).rejects.toBeInstanceOf(InsufficientStockError);

    // Neither line's warehouse — including the one that actually had enough
    // stock — was committed or reserved. Check-then-apply, never partial.
    expect(models.stockReservation.create).not.toHaveBeenCalled();
    expect(models.inventoryStock.updateMany).not.toHaveBeenCalled();
  });

  it("aggregates demand for the same variant at the same warehouse across multiple lines before checking availability", async () => {
    const { repo, models } = makeRepo();
    models.orderItem.findMany.mockResolvedValue([
      { variantId: "v1", quantity: 6n, warehouseId: "w-A" },
      { variantId: "v1", quantity: 6n, warehouseId: "w-A" },
    ]);

    // Shared mocked level has onHand=10n — 6+6=12 exceeds it, so this must
    // shortage even though neither individual line does on its own.
    await expect(
      repo.transition(actor, "o1", { toStatus: "processing", applyStock: true }),
    ).rejects.toBeInstanceOf(InsufficientStockError);
  });
});

describe("OrdersRepository — assign, bulk, activity, list", () => {
  it("assigns an order and logs it", async () => {
    const { repo, models } = makeRepo();
    models.order.findFirst.mockResolvedValueOnce({ id: "o1", assigneeId: null });
    const order = await repo.assign(actor, "o1", ACTOR);
    expect(order?.id).toBe("o1");
    expect(models.orderActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "assigned" }) }),
    );
  });

  it("reports per-item results in a bulk transition", async () => {
    const { repo } = makeRepo();
    const { results, changes } = await repo.bulkTransition(actor, ["o1"], {
      toStatus: "processing",
      applyStock: false,
    });
    expect(results).toEqual([{ orderId: "o1", ok: true }]);
    expect(changes).toHaveLength(1);
  });

  it("marks a not-found order in a bulk assign", async () => {
    const { repo, models } = makeRepo();
    models.order.findFirst.mockResolvedValue(null);
    const results = await repo.bulkAssign(actor, ["missing"], null);
    expect(results[0]).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("computes status counts", async () => {
    const { repo } = makeRepo();
    const counts = await repo.statusCounts(COMPANY, { sort: { field: "createdAt", dir: "desc" } });
    expect(counts.new).toBe(3);
    expect(counts.processing).toBe(0);
  });

  it("lists activity, or null when the order is absent", async () => {
    const { repo, models } = makeRepo();
    models.order.findFirst.mockResolvedValueOnce({ id: "o1" });
    expect(await repo.listActivity(COMPANY, "o1", undefined, undefined)).not.toBeNull();
    models.order.findFirst.mockResolvedValueOnce(null);
    expect(await repo.listActivity(COMPANY, "missing", undefined, undefined)).toBeNull();
  });

  it("returns a keyset page from list", async () => {
    const { repo, models } = makeRepo();
    models.order.findMany.mockResolvedValue([detailRow()]);
    const page = await repo.list(COMPANY, { sort: { field: "createdAt", dir: "desc" } });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]!.orderNumber).toBe(1042);
  });

  it("applies every filter, a number search, and a cursor", async () => {
    const { repo, models } = makeRepo();
    models.order.findMany.mockResolvedValue([detailRow()]);
    const cursor = encodeCursor({ p: "2026-01-01T00:00:00.000Z", t: "o0" });
    await repo.list(COMPANY, {
      sort: { field: "updatedAt", dir: "asc" },
      cursor,
      search: { kind: "number", value: 1042 },
      status: "processing",
      followUpState: "pending",
      assigneeId: "a1",
      customerId: CUSTOMER,
      labelId: "l1",
      reasonId: "r1",
      governorateId: "g1",
      createdAtFrom: "2026-01-01T00:00:00.000Z",
      createdAtTo: "2026-02-01T00:00:00.000Z",
    });
    const where = models.order.findMany.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where["status"]).toBe("processing");
    expect(where["orderNumber"]).toBe(1042n);
    expect(where["AND"]).toBeDefined(); // the keyset predicate
  });

  it("applies a text search over the customer name", async () => {
    const { repo, models } = makeRepo();
    await repo.list(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
      search: { kind: "text", term: "Sara" },
    });
    const where = models.order.findMany.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where["customer"]).toEqual({ name: { contains: "Sara", mode: "insensitive" } });
  });

  it("rejects a malformed cursor", async () => {
    const { repo } = makeRepo();
    await expect(
      repo.list(COMPANY, { sort: { field: "createdAt", dir: "desc" }, cursor: "@@bad@@" }),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe("OrdersRepository — update", () => {
  const current = {
    id: "o1",
    customerId: CUSTOMER,
    status: "new",
    subtotal: 30000n,
    shippingFee: 5000n,
    discount: 0n,
    total: 35000n,
    collectedAmount: 0n,
  };

  it("returns null for a missing order", async () => {
    const { repo, models } = makeRepo();
    models.order.findFirst.mockResolvedValueOnce(null);
    expect(await repo.update(actor, "missing", { notes: "x" })).toBeNull();
  });

  it("derives paymentStatus and recomputes KPIs on a collection", async () => {
    const { repo, models } = makeRepo();
    models.order.findFirst.mockResolvedValueOnce(current);
    await repo.update(actor, "o1", { collectedAmount: 35000 });
    const data = models.order.updateMany.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data["collectedAmount"]).toBe(35000n);
    expect(data["paymentStatus"]).toBe("paid");
    expect(models.customer.updateMany).toHaveBeenCalled();
  });

  it("replaces the item set and recomputes the subtotal", async () => {
    const { repo, models } = makeRepo();
    models.order.findFirst.mockResolvedValueOnce(current);
    await repo.update(actor, "o1", { items: [{ variantId: "v1", quantity: 3, price: 10000 }] });
    expect(models.orderItem.deleteMany).toHaveBeenCalled();
    const data = models.order.updateMany.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data["subtotal"]).toBe(30000n); // 3 × 10000
  });

  it("rejects an empty item replacement", async () => {
    const { repo, models } = makeRepo();
    models.order.findFirst.mockResolvedValueOnce(current);
    await expect(repo.update(actor, "o1", { items: [] })).rejects.toBeInstanceOf(Error);
  });

  it("records a note and reason on a cancel transition", async () => {
    const { repo, models } = makeRepo();
    await repo.transition(actor, "o1", {
      toStatus: "cancelled",
      applyStock: false,
      reasonId: "r1",
      note: "customer changed mind",
    });
    const activity = models.orderActivity.create.mock.calls.find(
      (c) => (c[0].data as Record<string, unknown>)["kind"] === "status_changed",
    );
    expect((activity![0].data as Record<string, unknown>)["note"]).toBe("customer changed mind");
    const orderUpdate = models.order.updateMany.mock.calls[0]![0].data as Record<string, unknown>;
    expect(orderUpdate["reasonId"]).toBe("r1");
  });
});

function uniqueViolation(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6",
    meta: { target },
  });
}

describe("OrdersRepository — reference + edge branches", () => {
  it("rejects a missing label reference", async () => {
    const { repo, models } = makeRepo();
    models.orderLabel.findFirst.mockResolvedValue(null);
    await expect(repo.create(actor, { ...CREATE, labelId: "l9" })).rejects.toMatchObject({
      field: "labelId",
    });
  });

  it("rejects a discount that drives the total negative", async () => {
    const { repo } = makeRepo();
    await expect(repo.create(actor, { ...CREATE, discount: 40000 })).rejects.toMatchObject({
      field: "discount",
    });
  });

  it("replays on a concurrent idempotency-key race", async () => {
    const { repo, models } = makeRepo();
    models.order.create.mockRejectedValueOnce(uniqueViolation("orders_idempotency_key"));
    models.order.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(detailRow());
    const result = await repo.create(actor, { ...CREATE, idempotencyKey: "k1" });
    expect(result.replayed).toBe(true);
  });

  it("falls back to the single warehouse when none is default", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue(null); // no default
    models.warehouse.findMany.mockResolvedValue([{ id: "only" }]);
    const change = await repo.transition(actor, "o1", { toStatus: "processing", applyStock: true });
    expect(change?.toStatus).toBe("processing");
  });

  it("requires a resolvable warehouse to reserve", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue(null);
    models.warehouse.findMany.mockResolvedValue([]); // none at all
    await expect(
      repo.transition(actor, "o1", { toStatus: "processing", applyStock: true }),
    ).rejects.toMatchObject({ field: "warehouseId" });
  });

  it("rejects assigning to a non-member", async () => {
    const { repo, models } = makeRepo();
    models.order.findFirst.mockResolvedValueOnce({ id: "o1", assigneeId: null });
    models.companyMember.findFirst.mockResolvedValue(null);
    await expect(repo.assign(actor, "o1", "ghost")).rejects.toMatchObject({ field: "assigneeId" });
  });

  it("maps an illegal transition to a per-item bulk error", async () => {
    const { repo } = makeRepo();
    const { results } = await repo.bulkTransition(actor, ["o1"], {
      toStatus: "delivered",
      applyStock: false,
    });
    expect(results[0]).toMatchObject({ ok: false, error: { code: "UNPROCESSABLE_ENTITY" } });
  });
});

describe("OrdersRepository — listVendorGroups (Vendor Accounts, Phase 2)", () => {
  it("returns an empty array when no items are warehouse-routed (every order today)", async () => {
    const { repo, models } = makeRepo();
    models.orderItem.findMany.mockResolvedValueOnce([]);
    const groups = await repo.listVendorGroups(actor, "o1");
    expect(groups).toEqual([]);
    expect(models.orderVendorGroup.createMany).not.toHaveBeenCalled();
  });

  it("groups items by warehouse and upserts one group row per warehouse", async () => {
    const { repo, models } = makeRepo();
    models.orderItem.findMany.mockResolvedValueOnce([
      {
        id: "i1",
        variantId: "v1",
        nameSnapshot: "A",
        quantity: 1n,
        price: 1000n,
        warehouseId: "w1",
      },
      {
        id: "i2",
        variantId: "v2",
        nameSnapshot: "B",
        quantity: 2n,
        price: 2000n,
        warehouseId: "w2",
      },
      {
        id: "i3",
        variantId: "v3",
        nameSnapshot: "C",
        quantity: 3n,
        price: 3000n,
        warehouseId: "w1",
      },
    ]);
    models.orderVendorGroup.findMany.mockResolvedValueOnce([
      { id: "g1", warehouseId: "w1", status: "new" },
      { id: "g2", warehouseId: "w2", status: "new" },
    ]);
    models.warehouse.findMany.mockResolvedValueOnce([
      { id: "w1", name: "Store A", code: "A" },
      { id: "w2", name: "Store B", code: null },
    ]);

    const groups = await repo.listVendorGroups(actor, "o1");

    expect(models.orderVendorGroup.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ orderId: "o1", warehouseId: "w1" }),
          expect.objectContaining({ orderId: "o1", warehouseId: "w2" }),
        ]),
        skipDuplicates: true,
      }),
    );
    expect(groups).toHaveLength(2);
    const groupA = groups.find((g) => g.warehouseId === "w1");
    expect(groupA).toMatchObject({ id: "g1", warehouseName: "Store A", warehouseCode: "A" });
    expect(groupA?.items.map((i) => i.id).sort()).toEqual(["i1", "i3"]);
    const groupB = groups.find((g) => g.warehouseId === "w2");
    expect(groupB).toMatchObject({ id: "g2", warehouseName: "Store B", warehouseCode: null });
    expect(groupB?.items.map((i) => i.id)).toEqual(["i2"]);
  });

  it("is idempotent: a second read does not duplicate group rows", async () => {
    const { repo, models } = makeRepo();
    models.orderItem.findMany.mockResolvedValue([
      {
        id: "i1",
        variantId: "v1",
        nameSnapshot: "A",
        quantity: 1n,
        price: 1000n,
        warehouseId: "w1",
      },
    ]);
    await repo.listVendorGroups(actor, "o1");
    await repo.listVendorGroups(actor, "o1");
    // createMany is called with skipDuplicates both times — the DB-level
    // uniqueness (order_id, warehouse_id) is what actually prevents a
    // duplicate; this asserts the repository always asks for that guarantee.
    for (const call of models.orderVendorGroup.createMany.mock.calls) {
      expect((call[0] as { skipDuplicates: boolean }).skipDuplicates).toBe(true);
    }
  });

  it("resolves the vendor's name when a member has joined that warehouse", async () => {
    const { repo, models } = makeRepo();
    models.orderItem.findMany.mockResolvedValueOnce([
      {
        id: "i1",
        variantId: "v1",
        nameSnapshot: "A",
        quantity: 1n,
        price: 1000n,
        warehouseId: "w1",
      },
    ]);
    models.orderVendorGroup.findMany.mockResolvedValueOnce([
      { id: "g1", warehouseId: "w1", status: "new" },
    ]);
    models.warehouse.findMany.mockResolvedValueOnce([{ id: "w1", name: "Store A", code: null }]);
    models.companyMember.findMany.mockResolvedValueOnce([
      { warehouseId: "w1", id: "member1", user: { fullName: "Vendor One", email: "v1@test.dev" } },
    ]);

    const groups = await repo.listVendorGroups(actor, "o1");
    expect(groups[0]).toMatchObject({ vendorMemberId: "member1", vendorName: "Vendor One" });
  });

  it("leaves the vendor identity null when no vendor has joined the warehouse yet", async () => {
    const { repo, models } = makeRepo();
    models.orderItem.findMany.mockResolvedValueOnce([
      {
        id: "i1",
        variantId: "v1",
        nameSnapshot: "A",
        quantity: 1n,
        price: 1000n,
        warehouseId: "w1",
      },
    ]);
    models.orderVendorGroup.findMany.mockResolvedValueOnce([
      { id: "g1", warehouseId: "w1", status: "new" },
    ]);
    models.warehouse.findMany.mockResolvedValueOnce([{ id: "w1", name: "Store A", code: null }]);
    models.companyMember.findMany.mockResolvedValueOnce([]);

    const groups = await repo.listVendorGroups(actor, "o1");
    expect(groups[0]).toMatchObject({ vendorMemberId: null, vendorName: null });
  });
});

describe("OrdersRepository — vendor self-service (Vendor Accounts, Phase 3)", () => {
  it("findVendorWarehouseId resolves an active vendor's warehouse", async () => {
    const { repo, models } = makeRepo();
    models.companyMember.findFirst.mockResolvedValueOnce({ warehouseId: "w1" });
    expect(await repo.findVendorWarehouseId(COMPANY, ACTOR)).toBe("w1");
  });

  it("findVendorWarehouseId returns null for a non-vendor caller", async () => {
    const { repo, models } = makeRepo();
    models.companyMember.findFirst.mockResolvedValueOnce(null);
    expect(await repo.findVendorWarehouseId(COMPANY, ACTOR)).toBeNull();
  });

  it("listVendorGroupsForWarehouse returns an empty array when nothing has been activated yet", async () => {
    const { repo, models } = makeRepo();
    models.orderVendorGroup.findMany.mockResolvedValueOnce([]);
    expect(await repo.listVendorGroupsForWarehouse(COMPANY, "w1")).toEqual([]);
  });

  it("listVendorGroupsForWarehouse lists groups across orders, newest first, with items", async () => {
    const { repo, models } = makeRepo();
    models.orderVendorGroup.findMany.mockResolvedValueOnce([
      { id: "g1", orderId: "o1", status: "new" },
      { id: "g2", orderId: "o2", status: "processing" },
    ]);
    models.order.findMany.mockResolvedValueOnce([
      { id: "o1", orderNumber: 1001n },
      { id: "o2", orderNumber: 1002n },
    ]);
    models.warehouse.findFirst.mockResolvedValueOnce({ name: "Store A", code: "A" });
    models.orderItem.findMany.mockResolvedValueOnce([
      { id: "i1", orderId: "o1", variantId: "v1", nameSnapshot: "A", quantity: 1n, price: 1000n },
      { id: "i2", orderId: "o2", variantId: "v2", nameSnapshot: "B", quantity: 2n, price: 2000n },
    ]);

    const groups = await repo.listVendorGroupsForWarehouse(COMPANY, "w1");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      id: "g1",
      orderId: "o1",
      orderNumber: 1001,
      warehouseName: "Store A",
      status: "new",
    });
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["i1"]);
    expect(groups[1]).toMatchObject({
      id: "g2",
      orderId: "o2",
      orderNumber: 1002,
      status: "processing",
    });
  });

  it("findVendorGroupById returns null when unknown in this tenant", async () => {
    const { repo, models } = makeRepo();
    models.orderVendorGroup.findFirst.mockResolvedValueOnce(null);
    expect(await repo.findVendorGroupById(COMPANY, "g9")).toBeNull();
  });

  it("updateVendorGroupStatus advances the status when the guard matches", async () => {
    const { repo, models } = makeRepo();
    models.orderVendorGroup.updateMany.mockResolvedValueOnce({ count: 1 });
    models.orderVendorGroup.findFirstOrThrow.mockResolvedValueOnce({
      orderId: "o1",
      warehouseId: "w1",
      status: "processing",
    });
    models.order.findFirst.mockResolvedValueOnce({ orderNumber: 1042n });
    models.warehouse.findFirst.mockResolvedValueOnce({ name: "Store A", code: null });
    models.orderItem.findMany.mockResolvedValueOnce([]);

    const updated = await repo.updateVendorGroupStatus(actor, "g1", "new", "processing");
    expect(updated).toMatchObject({ id: "g1", status: "processing", orderNumber: 1042 });
    expect(models.orderVendorGroup.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "g1", companyId: COMPANY, status: "new" }),
      }),
    );
  });

  it("updateVendorGroupStatus returns null when the guarded status no longer matches (concurrent change)", async () => {
    const { repo, models } = makeRepo();
    models.orderVendorGroup.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await repo.updateVendorGroupStatus(actor, "g1", "new", "processing")).toBeNull();
    expect(models.orderVendorGroup.findFirstOrThrow).not.toHaveBeenCalled();
  });
});

// Keeps the Prisma import referenced for the error-shape helper parity.
void Prisma;
