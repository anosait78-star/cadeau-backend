import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppException } from "../../../shared/errors/app-exception";
import type { WebhookProcessorService } from "../application/webhook-processor.service";
import { ShippingWebhooksController } from "./shipping-webhooks.controller";

const COMPANY = "11111111-1111-1111-1111-111111111111";

interface Harness {
  controller: ShippingWebhooksController;
  processor: { ingest: ReturnType<typeof vi.fn> };
}

function makeHarness(): Harness {
  const processor = { ingest: vi.fn().mockResolvedValue({ enqueued: true }) };
  const controller = new ShippingWebhooksController(
    processor as unknown as WebhookProcessorService,
  );
  return { controller, processor };
}

describe("ShippingWebhooksController", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("ingests a well-formed payload", async () => {
    const body = { eventId: "evt_1", trackingNumber: "MAN-ABC123", status: "picked_up" };
    const result = await h.controller.receive("manual", COMPANY, body);
    expect(h.processor.ingest).toHaveBeenCalledWith(COMPANY, "manual", "evt_1", body);
    expect(result).toEqual({ received: true });
  });

  it("rejects a payload missing eventId", async () => {
    await expect(
      h.controller.receive("manual", COMPANY, { trackingNumber: "MAN-ABC123" }),
    ).rejects.toBeInstanceOf(AppException);
    expect(h.processor.ingest).not.toHaveBeenCalled();
  });

  it("rejects a non-string eventId", async () => {
    await expect(h.controller.receive("manual", COMPANY, { eventId: 123 })).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it("returns received:true even on a duplicate (idempotent) delivery", async () => {
    h.processor.ingest.mockResolvedValueOnce({ enqueued: false });
    const result = await h.controller.receive("manual", COMPANY, { eventId: "evt_1" });
    expect(result).toEqual({ received: true });
  });
});
