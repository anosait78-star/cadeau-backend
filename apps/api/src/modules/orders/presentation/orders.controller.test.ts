import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { OrderActivityView, OrderListView, OrderView } from "../domain/order.entity";
import type { OrdersService } from "../application/orders.service";
import { OrdersController } from "./orders.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

const ORDER = "33333333-3333-3333-3333-333333333333";

function order(extra: Partial<OrderView> = {}): OrderView {
  return {
    id: ORDER,
    orderNumber: 1042,
    customerId: "c1",
    customerName: "Sara",
    assigneeId: null,
    status: "new",
    followUpState: "none",
    labelId: null,
    reasonId: null,
    governorateId: null,
    warehouseId: null,
    itemCount: 1,
    subtotal: 30000,
    shippingFee: 5000,
    discount: 0,
    total: 35000,
    collectedAmount: 0,
    paymentStatus: "unpaid",
    statusChangedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    notes: null,
    items: [],
    ...extra,
  };
}

function listPage(): KeysetPage<OrderListView> {
  return { data: [order()], page: { limit: 25, nextCursor: null, hasMore: false } };
}

function activityPage(): KeysetPage<OrderActivityView> {
  return { data: [], page: { limit: 25, nextCursor: null, hasMore: false } };
}

function fakeResponse(): Response {
  return { status: vi.fn(), setHeader: vi.fn() } as unknown as Response;
}

interface Harness {
  controller: OrdersController;
  service: { [K in keyof OrdersService]: ReturnType<typeof vi.fn> };
}

function makeHarness(): Harness {
  const service = {
    list: vi.fn().mockResolvedValue(listPage()),
    statusCounts: vi.fn().mockResolvedValue({ new: 1 }),
    getOne: vi.fn().mockResolvedValue(order()),
    create: vi.fn().mockResolvedValue({ order: order(), replayed: false }),
    update: vi.fn().mockResolvedValue(order()),
    transition: vi.fn().mockResolvedValue(order({ status: "processing" })),
    assign: vi.fn().mockResolvedValue(order({ assigneeId: principal.userId })),
    bulkTransition: vi.fn().mockResolvedValue([{ orderId: ORDER, ok: true }]),
    bulkAssign: vi.fn().mockResolvedValue([{ orderId: ORDER, ok: true }]),
    listActivity: vi.fn().mockResolvedValue(activityPage()),
    parse: vi.fn().mockReturnValue({
      name: "Sara",
      phone: "+201001234567",
      address: null,
      items: [],
      notes: null,
    }),
    importOrders: vi.fn().mockResolvedValue({ results: [{ row: 1, ok: true, orderId: ORDER }] }),
  } as unknown as Harness["service"];
  const controller = new OrdersController(service as unknown as OrdersService);
  return { controller, service };
}

describe("OrdersController", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("lists orders", async () => {
    const res = await h.controller.list(principal, {});
    expect(res.data).toHaveLength(1);
    expect(h.service.list).toHaveBeenCalledWith(principal, {});
  });

  it("returns status counts", async () => {
    const res = await h.controller.statusCounts(principal, {});
    expect(res.counts).toEqual({ new: 1 });
  });

  it("creates an order → 201 + Location", async () => {
    const res = fakeResponse();
    const body = { customerId: "c1", items: [{ variantId: "v1", quantity: 1, price: 1000 }] };
    await h.controller.create(principal, body as never, "key-1", res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.setHeader).toHaveBeenCalledWith("Location", `/v1/orders/${ORDER}`);
    expect(h.service.create).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({ idempotencyKey: "key-1" }),
    );
  });

  it("passes warehouseId, paymentStatus and collectedAmount through to the service", async () => {
    const res = fakeResponse();
    const body = {
      customerId: "c1",
      warehouseId: "w1",
      paymentStatus: "paid",
      collectedAmount: 35000,
      items: [{ variantId: "v1", quantity: 1, price: 1000 }],
    };
    await h.controller.create(principal, body as never, undefined, res);
    expect(h.service.create).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({ warehouseId: "w1", paymentStatus: "paid", collectedAmount: 35000 }),
    );
  });

  it("replays a create → 200, not 201", async () => {
    h.service.create.mockResolvedValueOnce({ order: order(), replayed: true });
    const res = fakeResponse();
    await h.controller.create(principal, { customerId: "c1", items: [] } as never, undefined, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("gets one order", async () => {
    const res = await h.controller.getOne(principal, ORDER);
    expect(res.id).toBe(ORDER);
  });

  it("updates an order", async () => {
    await h.controller.update(principal, ORDER, { notes: "x" });
    expect(h.service.update).toHaveBeenCalledWith(principal, ORDER, { notes: "x" });
  });

  it("transitions status", async () => {
    const res = await h.controller.transition(principal, ORDER, { toStatus: "processing" });
    expect(res.status).toBe("processing");
    expect(h.service.transition).toHaveBeenCalledWith(
      principal,
      ORDER,
      expect.objectContaining({ toStatus: "processing" }),
    );
  });

  it("assigns an order", async () => {
    await h.controller.assign(principal, ORDER, { assigneeId: principal.userId });
    expect(h.service.assign).toHaveBeenCalledWith(principal, ORDER, principal.userId);
  });

  it("bulk-transitions and bulk-assigns", async () => {
    const s = await h.controller.bulkStatus(principal, {
      orderIds: [ORDER],
      toStatus: "processing",
    } as never);
    expect(s.results).toHaveLength(1);
    const a = await h.controller.bulkAssign(principal, {
      orderIds: [ORDER],
      assigneeId: null,
    } as never);
    expect(a.results).toHaveLength(1);
  });

  it("lists activity", async () => {
    const res = await h.controller.activity(principal, ORDER, undefined, undefined);
    expect(res.data).toHaveLength(0);
  });

  it("parses pasted text", () => {
    const res = h.controller.parse(principal, { text: "Name: Sara\n01001234567" });
    expect(res.name).toBe("Sara");
    expect(h.service.parse).toHaveBeenCalledWith(principal, "Name: Sara\n01001234567");
  });

  it("imports CSV with a column mapping", async () => {
    const res = await h.controller.importOrders(principal, {
      csv: "customer,variant,qty,price\nc1,v1,2,15000",
      mapping: { customerId: "customer", variantId: "variant", quantity: "qty", price: "price" },
    });
    expect(res.results[0]).toMatchObject({ row: 1, ok: true });
  });
});
