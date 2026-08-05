import { describe, expect, it, vi } from "vitest";
import type { CarrierConnectionsRepositoryPort } from "../domain/carrier-connections-repository.port";
import type { CarrierPort } from "../domain/carrier.port";
import type { BostaCarrierAdapter } from "./bosta-carrier.adapter";
import { CarrierRouter } from "./carrier-router";
import type { ManualCarrierAdapter } from "./manual-carrier.adapter";

const COMPANY = "11111111-1111-1111-1111-111111111111";

function makeRouter(connected: boolean) {
  const connections = {
    list: vi.fn(),
    findActive: vi
      .fn()
      .mockResolvedValue(connected ? { apiKeyEncrypted: "enc", webhookTokenHash: "h" } : null),
    upsert: vi.fn(),
    deactivate: vi.fn(),
  };
  const manual: CarrierPort = {
    name: "manual",
    createShipment: vi.fn().mockResolvedValue({ trackingNumber: "MAN-1", carrier: "manual" }),
    getTracking: vi.fn().mockResolvedValue({ trackingNumber: "MAN-1", status: "created" }),
    generateWaybill: vi.fn().mockResolvedValue({ trackingNumber: "MAN-1", carrier: "manual" }),
    cancelShipment: vi.fn().mockResolvedValue(undefined),
  };
  const bosta: CarrierPort = {
    name: "bosta",
    createShipment: vi.fn().mockResolvedValue({ trackingNumber: "5108002", carrier: "bosta" }),
    getTracking: vi.fn().mockResolvedValue({ trackingNumber: "5108002", status: "picked_up" }),
    generateWaybill: vi.fn().mockResolvedValue({ trackingNumber: "5108002", carrier: "bosta" }),
    cancelShipment: vi.fn().mockResolvedValue(undefined),
  };
  const router = new CarrierRouter(
    connections as unknown as CarrierConnectionsRepositoryPort,
    manual as unknown as ManualCarrierAdapter,
    bosta as unknown as BostaCarrierAdapter,
  );
  return { router, connections, manual, bosta };
}

describe("CarrierRouter", () => {
  it("dispatches createShipment to bosta when the company has an active connection", async () => {
    const { router, bosta, manual } = makeRouter(true);
    const handle = await router.createShipment({ companyId: COMPANY, orderId: "o1" });
    expect(handle.carrier).toBe("bosta");
    expect(bosta.createShipment).toHaveBeenCalledWith({ companyId: COMPANY, orderId: "o1" });
    expect(manual.createShipment).not.toHaveBeenCalled();
  });

  it("dispatches createShipment to manual when there is no active connection", async () => {
    const { router, bosta, manual } = makeRouter(false);
    const handle = await router.createShipment({ companyId: COMPANY, orderId: "o1" });
    expect(handle.carrier).toBe("manual");
    expect(manual.createShipment).toHaveBeenCalled();
    expect(bosta.createShipment).not.toHaveBeenCalled();
  });

  it("dispatches getTracking/cancelShipment/generateWaybill the same way", async () => {
    const { router, bosta } = makeRouter(true);
    await router.getTracking(COMPANY, "5108002");
    await router.cancelShipment(COMPANY, "5108002");
    await router.generateWaybill(COMPANY, "5108002");
    expect(bosta.getTracking).toHaveBeenCalledWith(COMPANY, "5108002");
    expect(bosta.cancelShipment).toHaveBeenCalledWith(COMPANY, "5108002");
    expect(bosta.generateWaybill).toHaveBeenCalledWith(COMPANY, "5108002");
  });
});
