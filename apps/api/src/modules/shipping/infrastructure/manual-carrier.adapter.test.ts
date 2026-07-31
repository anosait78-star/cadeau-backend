import { describe, expect, it } from "vitest";
import { ManualCarrierAdapter } from "./manual-carrier.adapter";

describe("ManualCarrierAdapter", () => {
  const adapter = new ManualCarrierAdapter();

  it("carries the 'manual' carrier key (decision D1)", () => {
    expect(adapter.name).toBe("manual");
  });

  it("assigns a locally-generated, MAN-prefixed tracking number", async () => {
    const handle = await adapter.createShipment({ companyId: "c1", orderId: "o1" });
    expect(handle.trackingNumber).toMatch(/^MAN-[0-9a-f]{16}$/);
  });

  it("generates two different tracking numbers for two shipments", async () => {
    const a = await adapter.createShipment({ companyId: "c1", orderId: "o1" });
    const b = await adapter.createShipment({ companyId: "c1", orderId: "o2" });
    expect(a.trackingNumber).not.toBe(b.trackingNumber);
  });

  it("has no upstream to poll for tracking", async () => {
    await expect(adapter.getTracking("MAN-ABC123")).rejects.toThrow(
      "The manual carrier has no upstream to poll for tracking.",
    );
  });

  it("generates waybill metadata only (decision D3)", async () => {
    const waybill = await adapter.generateWaybill("MAN-ABC123");
    expect(waybill).toEqual({ trackingNumber: "MAN-ABC123", carrier: "manual" });
  });

  it("resolves cancelShipment (no external call)", async () => {
    await expect(adapter.cancelShipment("MAN-ABC123")).resolves.toBeUndefined();
  });
});
