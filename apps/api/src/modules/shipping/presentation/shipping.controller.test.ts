import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { ShipmentView } from "../domain/shipment.entity";
import type { ShippingService } from "../application/shipping.service";
import { ShippingController } from "./shipping.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

const SHIPMENT = "33333333-3333-3333-3333-333333333333";
const ORDER = "44444444-4444-4444-4444-444444444444";

function shipment(extra: Partial<ShipmentView> = {}): ShipmentView {
  return {
    id: SHIPMENT,
    orderId: ORDER,
    carrier: "manual",
    trackingNumber: "MAN-ABC123",
    status: "created",
    fee: 0,
    waybillIssued: false,
    deliveredAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function fakeResponse(): Response {
  return { status: vi.fn(), setHeader: vi.fn() } as unknown as Response;
}

interface Harness {
  controller: ShippingController;
  service: { [K in keyof ShippingService]: ReturnType<typeof vi.fn> };
}

function makeHarness(): Harness {
  const service = {
    listCarriers: vi
      .fn()
      .mockResolvedValue([
        { carrier: "manual", connected: true, pickupLocationWarning: false, connectedAt: null },
      ]),
    connectCarrier: vi.fn(),
    disconnectCarrier: vi.fn(),
    getOne: vi.fn().mockResolvedValue(shipment()),
    getByOrder: vi.fn().mockResolvedValue(shipment()),
    create: vi.fn().mockResolvedValue({ shipment: shipment(), replayed: false }),
    bulkCreate: vi.fn().mockResolvedValue([{ orderId: ORDER, ok: true, shipmentId: SHIPMENT }]),
    transition: vi.fn().mockResolvedValue(shipment({ status: "picked_up" })),
    cancel: vi.fn().mockResolvedValue(shipment({ status: "cancelled" })),
    generateWaybill: vi.fn().mockResolvedValue({
      shipment: shipment({ waybillIssued: true }),
      trackingNumber: "MAN-ABC123",
      carrier: "manual",
    }),
  } as unknown as Harness["service"];
  const controller = new ShippingController(service as unknown as ShippingService);
  return { controller, service };
}

describe("ShippingController", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("lists carriers with connection state", async () => {
    expect(await h.controller.listCarriers(principal)).toEqual({
      data: [{ key: "manual", connected: true, pickupLocationWarning: false, connectedAt: null }],
    });
  });

  it("connects a carrier and returns its connection state", async () => {
    h.service.connectCarrier.mockResolvedValueOnce({
      carrier: "bosta",
      connected: true,
      pickupLocationWarning: false,
      connectedAt: "2026-01-01T00:00:00.000Z",
    });
    const dto = await h.controller.connectCarrier(principal, "bosta", { apiKey: "secret" });
    expect(h.service.connectCarrier).toHaveBeenCalledWith(principal, "bosta", "secret");
    expect(dto).toEqual({
      key: "bosta",
      connected: true,
      pickupLocationWarning: false,
      connectedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("disconnects a carrier", async () => {
    await h.controller.disconnectCarrier(principal, "bosta");
    expect(h.service.disconnectCarrier).toHaveBeenCalledWith(principal, "bosta");
  });

  it("creates a shipment, sets 201 + Location, and forwards the idempotency key", async () => {
    const res = fakeResponse();
    const dto = await h.controller.create(principal, { orderId: ORDER }, "key-1", res);
    expect(h.service.create).toHaveBeenCalledWith(principal, {
      orderId: ORDER,
      idempotencyKey: "key-1",
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.setHeader).toHaveBeenCalledWith("Location", `/v1/shipping/shipments/${SHIPMENT}`);
    expect(dto.id).toBe(SHIPMENT);
  });

  it("returns 200 on an idempotent replay", async () => {
    h.service.create.mockResolvedValueOnce({ shipment: shipment(), replayed: true });
    const res = fakeResponse();
    await h.controller.create(principal, { orderId: ORDER }, undefined, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("bulk-creates shipments from a list of order ids", async () => {
    const result = await h.controller.bulkCreate(principal, { orderIds: [ORDER] });
    expect(h.service.bulkCreate).toHaveBeenCalledWith(principal, [{ orderId: ORDER }]);
    expect(result.results).toEqual([{ orderId: ORDER, ok: true, shipmentId: SHIPMENT }]);
  });

  it("gets a shipment by id", async () => {
    const dto = await h.controller.getOne(principal, SHIPMENT);
    expect(h.service.getOne).toHaveBeenCalledWith(principal, SHIPMENT);
    expect(dto.id).toBe(SHIPMENT);
  });

  it("gets the most recent shipment for an order", async () => {
    const dto = await h.controller.getByOrder(principal, ORDER);
    expect(h.service.getByOrder).toHaveBeenCalledWith(principal, ORDER);
    expect(dto.id).toBe(SHIPMENT);
  });

  it("transitions a shipment status", async () => {
    const dto = await h.controller.transition(principal, SHIPMENT, { toStatus: "picked_up" });
    expect(h.service.transition).toHaveBeenCalledWith(principal, SHIPMENT, {
      toStatus: "picked_up",
    });
    expect(dto.status).toBe("picked_up");
  });

  it("generates a waybill (metadata only)", async () => {
    const dto = await h.controller.generateWaybill(principal, SHIPMENT);
    expect(h.service.generateWaybill).toHaveBeenCalledWith(principal, SHIPMENT);
    expect(dto).toEqual({ shipmentId: SHIPMENT, carrier: "manual", trackingNumber: "MAN-ABC123" });
  });
});
