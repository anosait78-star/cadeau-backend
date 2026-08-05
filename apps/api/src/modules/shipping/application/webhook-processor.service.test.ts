import { beforeEach, describe, expect, it, vi } from "vitest";
import { IllegalTransitionError } from "../domain/shipping.errors";
import type { PendingWebhookEvent, WebhookInboxPort } from "../domain/webhook-inbox.port";
import type { ShippingService } from "./shipping.service";
import { WebhookProcessorService } from "./webhook-processor.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const SHIPMENT = "22222222-2222-2222-2222-222222222222";

function event(extra: Partial<PendingWebhookEvent> = {}): PendingWebhookEvent {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    companyId: COMPANY,
    carrier: "manual",
    carrierEventId: "evt_1",
    payload: { trackingNumber: "MAN-ABC123", status: "picked_up" },
    attempts: 0,
    ...extra,
  };
}

interface Harness {
  processor: WebhookProcessorService;
  inbox: { [K in keyof WebhookInboxPort]: ReturnType<typeof vi.fn> };
  shipping: {
    findShipmentByTracking: ReturnType<typeof vi.fn>;
    applySystemTransition: ReturnType<typeof vi.fn>;
  };
}

function makeHarness(): Harness {
  const inbox = {
    enqueue: vi.fn().mockResolvedValue({ enqueued: true }),
    claimBatch: vi.fn().mockResolvedValue([event()]),
    markProcessed: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  };
  const shipping = {
    findShipmentByTracking: vi.fn().mockResolvedValue({ id: SHIPMENT }),
    applySystemTransition: vi.fn().mockResolvedValue({ id: SHIPMENT, status: "picked_up" }),
  };
  const processor = new WebhookProcessorService(
    inbox as unknown as WebhookInboxPort,
    shipping as unknown as ShippingService,
  );
  return { processor, inbox, shipping };
}

describe("WebhookProcessorService", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  describe("ingest", () => {
    it("delegates to the inbox", async () => {
      await h.processor.ingest(COMPANY, "manual", "evt_1", { trackingNumber: "MAN-ABC123" });
      expect(h.inbox.enqueue).toHaveBeenCalledWith(COMPANY, "manual", "evt_1", {
        trackingNumber: "MAN-ABC123",
      });
    });
  });

  describe("processBatch", () => {
    it("returns zero counts when nothing is due", async () => {
      h.inbox.claimBatch.mockResolvedValueOnce([]);
      const result = await h.processor.processBatch(20);
      expect(result).toEqual({ processed: 0, failed: 0 });
      expect(h.shipping.findShipmentByTracking).not.toHaveBeenCalled();
    });

    it("resolves the shipment by tracking number and applies the transition", async () => {
      const result = await h.processor.processBatch(20);
      expect(h.shipping.findShipmentByTracking).toHaveBeenCalledWith(
        COMPANY,
        "manual",
        "MAN-ABC123",
      );
      expect(h.shipping.applySystemTransition).toHaveBeenCalledWith(COMPANY, SHIPMENT, {
        toStatus: "picked_up",
      });
      expect(h.inbox.markProcessed).toHaveBeenCalledWith(COMPANY, event().id);
      expect(result).toEqual({ processed: 1, failed: 0 });
    });

    it("passes note through when present", async () => {
      h.inbox.claimBatch.mockResolvedValueOnce([
        event({ payload: { trackingNumber: "MAN-ABC123", status: "returned", note: "damaged" } }),
      ]);
      await h.processor.processBatch(20);
      expect(h.shipping.applySystemTransition).toHaveBeenCalledWith(COMPANY, SHIPMENT, {
        toStatus: "returned",
        note: "damaged",
      });
    });

    it("marks failed (with backoff) when trackingNumber is missing", async () => {
      h.inbox.claimBatch.mockResolvedValueOnce([event({ payload: { status: "picked_up" } })]);
      const result = await h.processor.processBatch(20);
      expect(h.inbox.markFailed).toHaveBeenCalledWith(COMPANY, event().id, 1);
      expect(result).toEqual({ processed: 0, failed: 1 });
    });

    it("marks failed when status is invalid", async () => {
      h.inbox.claimBatch.mockResolvedValueOnce([
        event({ payload: { trackingNumber: "MAN-ABC123", status: "not-a-status" } }),
      ]);
      await h.processor.processBatch(20);
      expect(h.inbox.markFailed).toHaveBeenCalledWith(COMPANY, event().id, 1);
    });

    it("marks failed when no shipment matches the tracking number", async () => {
      h.shipping.findShipmentByTracking.mockResolvedValueOnce(null);
      await h.processor.processBatch(20);
      expect(h.inbox.markFailed).toHaveBeenCalledWith(COMPANY, event().id, 1);
      expect(h.shipping.applySystemTransition).not.toHaveBeenCalled();
    });

    it("treats a duplicate/already-there transition (IllegalTransitionError) as processed, not failed", async () => {
      h.shipping.applySystemTransition.mockRejectedValueOnce(
        new IllegalTransitionError("delivered", "delivered"),
      );
      const result = await h.processor.processBatch(20);
      expect(h.inbox.markProcessed).toHaveBeenCalled();
      expect(h.inbox.markFailed).not.toHaveBeenCalled();
      expect(result).toEqual({ processed: 1, failed: 0 });
    });

    it("marks failed on any other transition error, carrying the incremented attempt count", async () => {
      h.shipping.applySystemTransition.mockRejectedValueOnce(new Error("db down"));
      h.inbox.claimBatch.mockResolvedValueOnce([event({ attempts: 3 })]);
      const result = await h.processor.processBatch(20);
      expect(h.inbox.markFailed).toHaveBeenCalledWith(COMPANY, event().id, 4);
      expect(result).toEqual({ processed: 0, failed: 1 });
    });

    it("processes multiple due events independently", async () => {
      h.inbox.claimBatch.mockResolvedValueOnce([
        event({ id: "a" }),
        event({ id: "b", payload: { trackingNumber: "MAN-ABC123", status: "not-valid" } }),
      ]);
      const result = await h.processor.processBatch(20);
      expect(result).toEqual({ processed: 1, failed: 1 });
    });
  });
});
