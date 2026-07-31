import { Prisma, type PrismaClient } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import type { CarrierPort } from "../domain/carrier.port";
import {
  DuplicateActiveShipmentError,
  IllegalTransitionError,
  OrderNotShippableError,
  ReferenceNotFoundError,
} from "../domain/shipping.errors";
import { ShippingRepository } from "./shipping.repository";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const ORDER = "33333333-3333-3333-3333-333333333333";
const DATE = new Date("2026-01-02T03:04:05.000Z");

const actor = { companyId: COMPANY, actorId: ACTOR };

function uniqueViolation(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6",
    meta: { target },
  });
}

function shipmentRow(extra: Record<string, unknown> = {}) {
  return {
    id: "s1",
    orderId: ORDER,
    carrier: "manual",
    trackingNumber: "MAN-ABC123",
    status: "created",
    fee: 0n,
    waybillIssued: false,
    deliveredAt: null,
    createdAt: DATE,
    updatedAt: DATE,
    ...extra,
  };
}

function makeCarrier() {
  return {
    name: "manual" as const,
    createShipment: vi.fn().mockResolvedValue({ trackingNumber: "MAN-ABC123" }),
    getTracking: vi.fn(),
    generateWaybill: vi.fn().mockResolvedValue({ trackingNumber: "MAN-ABC123", carrier: "manual" }),
    cancelShipment: vi.fn().mockResolvedValue(undefined),
  };
}

/** Configurable state for the two `FOR UPDATE` locks (order, shipment). */
function makeRepo(
  options: {
    orderStatus?: string;
    orderMissing?: boolean;
    collectedAmount?: bigint;
    shipmentStatus?: string;
    shipmentMissing?: boolean;
    fee?: bigint;
    feeOrderMissing?: boolean;
  } = {},
) {
  const state = {
    orderStatus: options.orderStatus ?? "ready",
    orderMissing: options.orderMissing ?? false,
    collectedAmount: options.collectedAmount ?? 10_000n,
    shipmentStatus: options.shipmentStatus ?? "created",
    shipmentMissing: options.shipmentMissing ?? false,
    fee: options.fee ?? 0n,
    feeOrderMissing: options.feeOrderMissing ?? false,
  };
  const models = {
    shipment: {
      findFirst: vi.fn().mockResolvedValue(null),
      findFirstOrThrow: vi.fn().mockResolvedValue(shipmentRow({ status: state.shipmentStatus })),
      create: vi.fn().mockResolvedValue(shipmentRow()),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    order: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    orderActivity: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const queryRaw = vi.fn((strings: TemplateStringsArray) => {
    const sql = strings.join(" ");
    if (sql.includes("FROM public.orders") && sql.includes("collected_amount")) {
      return Promise.resolve(
        state.feeOrderMissing ? [] : [{ collected_amount: state.collectedAmount }],
      );
    }
    if (sql.includes("FROM public.orders")) {
      return Promise.resolve(state.orderMissing ? [] : [{ id: ORDER, status: state.orderStatus }]);
    }
    if (sql.includes("FROM public.shipments")) {
      return Promise.resolve(
        state.shipmentMissing
          ? []
          : [
              {
                id: "s1",
                status: state.shipmentStatus,
                order_id: ORDER,
                tracking_number: "MAN-ABC123",
                fee: state.fee,
              },
            ],
      );
    }
    return Promise.resolve([]);
  });
  const txHost = { $queryRaw: queryRaw, ...models };
  const prisma = { $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(txHost)) };
  const carrier = makeCarrier();
  const repo = new ShippingRepository(
    prisma as unknown as PrismaClient,
    carrier as unknown as CarrierPort,
  );
  return { repo, models, queryRaw, carrier, state };
}

describe("ShippingRepository — findById / findByTrackingNumber / findLatestByOrderId", () => {
  it("returns null when absent", async () => {
    const { repo } = makeRepo();
    expect(await repo.findById(COMPANY, "missing")).toBeNull();
    expect(await repo.findByTrackingNumber(COMPANY, "manual", "MAN-XXX")).toBeNull();
    expect(await repo.findLatestByOrderId(COMPANY, ORDER)).toBeNull();
  });

  it("finds the most recent shipment for an order", async () => {
    const { repo, models } = makeRepo();
    models.shipment.findFirst.mockResolvedValueOnce(shipmentRow());
    const view = await repo.findLatestByOrderId(COMPANY, ORDER);
    expect(view?.orderId).toBe(ORDER);
    expect(models.shipment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: COMPANY, orderId: ORDER } }),
    );
  });

  it("maps a found row to a view", async () => {
    const { repo, models } = makeRepo();
    models.shipment.findFirst.mockResolvedValueOnce(shipmentRow({ fee: 2500n }));
    const view = await repo.findById(COMPANY, "s1");
    expect(view).toMatchObject({ id: "s1", fee: 2500, carrier: "manual" });
  });

  it("maps a found row by tracking number to a view", async () => {
    const { repo, models } = makeRepo();
    models.shipment.findFirst.mockResolvedValueOnce(shipmentRow());
    const view = await repo.findByTrackingNumber(COMPANY, "manual", "MAN-ABC123");
    expect(view?.id).toBe("s1");
  });
});

describe("ShippingRepository — create", () => {
  it("books the carrier and inserts the shipment", async () => {
    const { repo, models, carrier } = makeRepo({ orderStatus: "ready" });
    const { shipment, replayed } = await repo.create(actor, { orderId: ORDER });
    expect(carrier.createShipment).toHaveBeenCalledWith({ companyId: COMPANY, orderId: ORDER });
    const data = models.shipment.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data["orderId"]).toBe(ORDER);
    expect(data["carrier"]).toBe("manual");
    expect(data["trackingNumber"]).toBe("MAN-ABC123");
    expect(replayed).toBe(false);
    expect(shipment.id).toBe("s1");
  });

  it("rejects when the order does not exist", async () => {
    const { repo } = makeRepo({ orderMissing: true });
    await expect(repo.create(actor, { orderId: ORDER })).rejects.toBeInstanceOf(
      ReferenceNotFoundError,
    );
  });

  it("rejects when the order is not in a shippable status", async () => {
    const { repo } = makeRepo({ orderStatus: "new" });
    await expect(repo.create(actor, { orderId: ORDER })).rejects.toBeInstanceOf(
      OrderNotShippableError,
    );
  });

  it("rejects a second active shipment for the same order", async () => {
    const { repo, models } = makeRepo({ orderStatus: "shipped" });
    models.shipment.findFirst.mockResolvedValueOnce(shipmentRow({ status: "in_transit" }));
    await expect(repo.create(actor, { orderId: ORDER })).rejects.toBeInstanceOf(
      DuplicateActiveShipmentError,
    );
  });

  it("replays an existing idempotency key without booking a new carrier shipment", async () => {
    const { repo, models, carrier } = makeRepo();
    models.shipment.findFirst.mockResolvedValueOnce(shipmentRow());
    const result = await repo.create(actor, { orderId: ORDER, idempotencyKey: "k1" });
    expect(result.replayed).toBe(true);
    expect(carrier.createShipment).not.toHaveBeenCalled();
    expect(models.shipment.create).not.toHaveBeenCalled();
  });

  it("treats a P2002 race on the idempotency key as a replay", async () => {
    const { repo, models } = makeRepo();
    models.shipment.findFirst
      .mockResolvedValueOnce(null) // pre-check: no replay yet
      .mockResolvedValueOnce(null) // active-shipment check: none held
      .mockResolvedValueOnce(shipmentRow()); // post-race: the concurrent insert won
    models.shipment.create.mockRejectedValueOnce(uniqueViolation("shipments_idempotency_key"));
    const result = await repo.create(actor, { orderId: ORDER, idempotencyKey: "k1" });
    expect(result.replayed).toBe(true);
  });

  it("propagates an unrelated P2002 error unchanged (not idempotency-related)", async () => {
    const { repo, models } = makeRepo();
    models.shipment.create.mockRejectedValueOnce(
      uniqueViolation("shipments_company_carrier_tracking_key"),
    );
    await expect(repo.create(actor, { orderId: ORDER, idempotencyKey: "k1" })).rejects.toThrow(
      "Unique constraint failed",
    );
  });

  it("propagates a non-P2002 write error unchanged", async () => {
    const { repo, models } = makeRepo();
    models.shipment.create.mockRejectedValueOnce(new Error("db exploded"));
    await expect(repo.create(actor, { orderId: ORDER })).rejects.toThrow("db exploded");
  });
});

describe("ShippingRepository — bulkCreate", () => {
  it("is atomic per order: one bad order does not fail the others", async () => {
    const { repo } = makeRepo({ orderStatus: "new" }); // not shippable → every item fails
    const { results, created } = await repo.bulkCreate(actor, [{ orderId: ORDER }]);
    expect(results).toEqual([
      {
        orderId: ORDER,
        ok: false,
        error: { code: "UNPROCESSABLE_ENTITY", message: expect.any(String) },
      },
    ]);
    expect(created).toHaveLength(0);
  });

  it("bulk-reports a duplicate-active-shipment error", async () => {
    const { repo, models } = makeRepo({ orderStatus: "shipped" });
    models.shipment.findFirst.mockResolvedValueOnce(shipmentRow({ status: "in_transit" }));
    const { results } = await repo.bulkCreate(actor, [{ orderId: ORDER }]);
    expect(results[0]).toMatchObject({ ok: false, error: { code: "UNPROCESSABLE_ENTITY" } });
  });

  it("bulk-reports a reference-not-found error", async () => {
    const { repo } = makeRepo({ orderMissing: true });
    const { results } = await repo.bulkCreate(actor, [{ orderId: ORDER }]);
    expect(results[0]).toMatchObject({ ok: false, error: { code: "UNPROCESSABLE_ENTITY" } });
  });

  it("falls back to an INTERNAL bulk error for an unrecognized failure", async () => {
    const { repo, carrier } = makeRepo({ orderStatus: "ready" });
    carrier.createShipment.mockRejectedValueOnce(new Error("carrier down"));
    const { results } = await repo.bulkCreate(actor, [{ orderId: ORDER }]);
    expect(results[0]).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
  });
});

describe("ShippingRepository — transition", () => {
  it("transitions status without side effects for an ordinary move", async () => {
    const { repo, models } = makeRepo({ shipmentStatus: "created" });
    const change = await repo.transition(actor, "s1", { toStatus: "picked_up" });
    expect(change).not.toBeNull();
    expect(change?.fromStatus).toBe("created");
    expect(change?.toStatus).toBe("picked_up");
    expect(change?.feeDeducted).toBe(0);
    expect(models.shipment.updateMany).toHaveBeenCalled();
  });

  it("returns null for a missing shipment", async () => {
    const { repo } = makeRepo({ shipmentMissing: true });
    expect(await repo.transition(actor, "missing", { toStatus: "picked_up" })).toBeNull();
  });

  it("rejects an illegal transition", async () => {
    const { repo } = makeRepo({ shipmentStatus: "created" });
    await expect(repo.transition(actor, "s1", { toStatus: "delivered" })).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
  });

  it("rejects a transition to the same status", async () => {
    const { repo } = makeRepo({ shipmentStatus: "created" });
    await expect(repo.transition(actor, "s1", { toStatus: "created" })).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
  });

  it("maps a non-null deliveredAt to an ISO string", async () => {
    const { repo, models } = makeRepo({ shipmentStatus: "in_transit" });
    models.shipment.findFirstOrThrow.mockResolvedValueOnce(
      shipmentRow({ status: "delivered", deliveredAt: DATE }),
    );
    const change = await repo.transition(actor, "s1", { toStatus: "delivered" });
    expect(change?.shipment.deliveredAt).toBe(DATE.toISOString());
  });

  it("calls the carrier to cancel on a cancel transition", async () => {
    const { repo, carrier } = makeRepo({ shipmentStatus: "created" });
    await repo.transition(actor, "s1", { toStatus: "cancelled" });
    expect(carrier.cancelShipment).toHaveBeenCalledWith("MAN-ABC123");
  });

  it("deducts the fee from the order's collectedAmount on delivery (D4)", async () => {
    const { repo, models } = makeRepo({
      shipmentStatus: "in_transit",
      fee: 2_500n,
      collectedAmount: 10_000n,
    });
    const change = await repo.transition(actor, "s1", { toStatus: "delivered" });
    expect(change?.feeDeducted).toBe(2500);
    const orderUpdate = models.order.updateMany.mock.calls[0]![0] as {
      data: { collectedAmount: { decrement: bigint } };
    };
    expect(orderUpdate.data.collectedAmount.decrement).toBe(2500n);
    expect(models.orderActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "payment" }) }),
    );
  });

  it("clamps the deduction to the collected amount so it never goes negative", async () => {
    const { repo, models } = makeRepo({
      shipmentStatus: "in_transit",
      fee: 5_000n,
      collectedAmount: 1_000n,
    });
    const change = await repo.transition(actor, "s1", { toStatus: "delivered" });
    expect(change?.feeDeducted).toBe(1000);
    const orderUpdate = models.order.updateMany.mock.calls[0]![0] as {
      data: { collectedAmount: { decrement: bigint } };
    };
    expect(orderUpdate.data.collectedAmount.decrement).toBe(1000n);
  });

  it("deducts nothing when the fee is zero", async () => {
    const { repo, models } = makeRepo({ shipmentStatus: "in_transit", fee: 0n });
    const change = await repo.transition(actor, "s1", { toStatus: "delivered" });
    expect(change?.feeDeducted).toBe(0);
    expect(models.order.updateMany).not.toHaveBeenCalled();
  });

  it("deducts nothing when the order has already collected zero", async () => {
    const { repo, models } = makeRepo({
      shipmentStatus: "in_transit",
      fee: 2_500n,
      collectedAmount: 0n,
    });
    const change = await repo.transition(actor, "s1", { toStatus: "delivered" });
    expect(change?.feeDeducted).toBe(0);
    expect(models.order.updateMany).not.toHaveBeenCalled();
  });

  it("deducts nothing when the order can't be found for fee deduction", async () => {
    const { repo, models } = makeRepo({
      shipmentStatus: "in_transit",
      fee: 2_500n,
      feeOrderMissing: true,
    });
    const change = await repo.transition(actor, "s1", { toStatus: "delivered" });
    expect(change?.feeDeducted).toBe(0);
    expect(models.order.updateMany).not.toHaveBeenCalled();
  });
});

describe("ShippingRepository — issueWaybill", () => {
  it("flips the waybillIssued flag", async () => {
    const { repo, models } = makeRepo();
    models.shipment.findFirst.mockResolvedValueOnce(shipmentRow());
    const shipment = await repo.issueWaybill(actor, "s1");
    expect(shipment).not.toBeNull();
    const patch = models.shipment.updateMany.mock.calls[0]![0].data as Record<string, unknown>;
    expect(patch["waybillIssued"]).toBe(true);
  });

  it("returns null for a missing shipment", async () => {
    const { repo, models } = makeRepo();
    models.shipment.findFirst.mockResolvedValueOnce(null);
    expect(await repo.issueWaybill(actor, "missing")).toBeNull();
  });
});
