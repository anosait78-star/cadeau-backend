import { Inject, Injectable } from "@nestjs/common";
import { isValidStatus, type ShipmentStatus } from "../domain/shipment-status";
import { IllegalTransitionError } from "../domain/shipping.errors";
import {
  WEBHOOK_INBOX,
  type PendingWebhookEvent,
  type WebhookInboxPort,
} from "../domain/webhook-inbox.port";
import { ShippingService } from "./shipping.service";

/** The outcome of one retry-worker poll tick. */
export interface ProcessBatchResult {
  readonly processed: number;
  readonly failed: number;
}

interface ParsedWebhookPayload {
  readonly trackingNumber: string;
  readonly status: ShipmentStatus;
  readonly note?: string;
}

/**
 * Ingests inbound carrier webhooks into the durable inbox and processes due
 * events into shipment status transitions (EPIC-12 M12.4, decision D2).
 *
 * `ingest` is the signature-verified route's only job: write the raw,
 * already-parsed body to `shipping_webhook_events`, idempotent on
 * `(carrier, carrierEventId)`. `processBatch` is what the retry worker calls
 * on each poll tick: claim due rows, apply each as a shipment transition
 * through {@link ShippingService.applySystemTransition} (audit + events ride
 * along for free, same as any other transition), and mark the row processed
 * or failed-with-backoff.
 */
@Injectable()
export class WebhookProcessorService {
  constructor(
    @Inject(WEBHOOK_INBOX) private readonly inbox: WebhookInboxPort,
    private readonly shipping: ShippingService,
  ) {}

  /** Write a signature-verified webhook to the durable inbox. Idempotent. */
  ingest(
    companyId: string,
    carrier: string,
    carrierEventId: string,
    payload: unknown,
  ): Promise<{ enqueued: boolean }> {
    return this.inbox.enqueue(companyId, carrier, carrierEventId, payload);
  }

  /** Claim and process up to `limit` due events. Called by the retry worker's poll tick. */
  async processBatch(limit: number): Promise<ProcessBatchResult> {
    const events = await this.inbox.claimBatch(limit);
    let processed = 0;
    let failed = 0;
    for (const event of events) {
      // Sequential, not parallel: keeps the worker's DB load predictable and
      // avoids two events for the same shipment racing each other.
      if (await this.processOne(event)) processed += 1;
      else failed += 1;
    }
    return { processed, failed };
  }

  private async processOne(event: PendingWebhookEvent): Promise<boolean> {
    try {
      const { trackingNumber, status, note } = this.parsePayload(event);
      const shipment = await this.shipping.findShipmentByTracking(
        event.companyId,
        event.carrier,
        trackingNumber,
      );
      if (shipment === null) {
        throw new Error(`No shipment found for tracking number ${trackingNumber}.`);
      }
      try {
        await this.shipping.applySystemTransition(event.companyId, shipment.id, {
          toStatus: status,
          ...(note !== undefined ? { note } : {}),
        });
      } catch (error) {
        // A carrier resending the same status (e.g. a duplicate "delivered"
        // with a new event id) is harmless — the shipment is already there.
        // Treat as processed, not a failure to keep retrying forever.
        if (!(error instanceof IllegalTransitionError)) throw error;
      }
      await this.inbox.markProcessed(event.companyId, event.id);
      return true;
    } catch {
      await this.inbox.markFailed(event.companyId, event.id, event.attempts + 1);
      return false;
    }
  }

  private parsePayload(event: PendingWebhookEvent): ParsedWebhookPayload {
    const payload = event.payload as Record<string, unknown> | null;
    const trackingNumber = payload?.["trackingNumber"];
    const status = payload?.["status"];
    const note = payload?.["note"];
    if (typeof trackingNumber !== "string" || trackingNumber.length === 0) {
      throw new Error("Webhook payload is missing trackingNumber.");
    }
    if (typeof status !== "string" || !isValidStatus(status)) {
      throw new Error("Webhook payload has a missing or invalid status.");
    }
    return {
      trackingNumber,
      status,
      ...(typeof note === "string" ? { note } : {}),
    };
  }
}
