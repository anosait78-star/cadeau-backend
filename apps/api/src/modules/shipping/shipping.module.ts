import { Module } from "@nestjs/common";
import { systemClockProvider } from "../../shared/time/clock";
import { ShippingService } from "./application/shipping.service";
import { WebhookProcessorService } from "./application/webhook-processor.service";
import { CARRIER_PORT } from "./domain/carrier.port";
import { SHIPPING_AUDIT } from "./domain/shipping-audit.port";
import { SHIPPING_REPOSITORY } from "./domain/shipping-repository.port";
import { WEBHOOK_INBOX } from "./domain/webhook-inbox.port";
import { ShippingAuditLogAdapter } from "./infrastructure/audit-log.adapter";
import { ManualCarrierAdapter } from "./infrastructure/manual-carrier.adapter";
import { shippingPrismaClientProvider } from "./infrastructure/prisma-client.provider";
import { ShippingRepository } from "./infrastructure/shipping.repository";
import { WebhookInboxRepository } from "./infrastructure/webhook-inbox.repository";
import { WebhookRetryWorker } from "./infrastructure/webhook-retry-worker";
import { ShippingController } from "./presentation/shipping.controller";
import { ShippingWebhooksController } from "./presentation/shipping-webhooks.controller";

/**
 * Shipping feature module (composition root, EPIC-12). Wires the service to
 * the Prisma repository (which owns order validation, the carrier dispatch
 * and the fee deduction on delivery), the durable audit adapter, the
 * `/v1/shipping` controller (M12.3 — carriers/shipments/bulk/detail/status/
 * waybill), and the M12.4 webhook pipeline: `ShippingWebhooksController`
 * (signature-verified ingestion) → `WebhookInboxRepository` (durable,
 * idempotent inbox) → `WebhookRetryWorker` (polls + backs off) →
 * `WebhookProcessorService` (applies the transition via `ShippingService`).
 * The only {@link CarrierPort} bound today is {@link ManualCarrierAdapter}
 * (decision D1) — a real carrier is an additive provider swap, never a
 * caller change. The three-layer resolver + guards come from the global
 * {@link AccessCoreModule}; the event bus from {@link EventBusModule}; the
 * validated config `WebhookSignatureGuard`/`WebhookRetryWorker` inject comes
 * from the global {@link ConfigModule}.
 */
@Module({
  controllers: [ShippingController, ShippingWebhooksController],
  providers: [
    ShippingService,
    WebhookProcessorService,
    WebhookRetryWorker,
    systemClockProvider,
    shippingPrismaClientProvider,
    { provide: CARRIER_PORT, useClass: ManualCarrierAdapter },
    { provide: SHIPPING_REPOSITORY, useClass: ShippingRepository },
    { provide: SHIPPING_AUDIT, useClass: ShippingAuditLogAdapter },
    { provide: WEBHOOK_INBOX, useClass: WebhookInboxRepository },
  ],
  exports: [ShippingService],
})
export class ShippingModule {}
