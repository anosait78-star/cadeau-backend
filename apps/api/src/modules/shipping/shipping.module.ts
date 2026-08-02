import { Module } from "@nestjs/common";
import { APP_CONFIG, type InjectedAppConfig } from "../../shared/config/config.tokens";
import { systemClockProvider } from "../../shared/time/clock";
import { ShippingService } from "./application/shipping.service";
import { WebhookProcessorService } from "./application/webhook-processor.service";
import { BOSTA_CATALOG_CACHE } from "./domain/bosta-catalog-cache.port";
import { BOSTA_HTTP_CLIENT } from "./domain/bosta-http-client.port";
import { CARRIER_CONNECTIONS_REPOSITORY } from "./domain/carrier-connections-repository.port";
import { CARRIER_PORT } from "./domain/carrier.port";
import { SHIPPING_AUDIT } from "./domain/shipping-audit.port";
import { SHIPPING_REPOSITORY } from "./domain/shipping-repository.port";
import { WEBHOOK_INBOX } from "./domain/webhook-inbox.port";
import { ShippingAuditLogAdapter } from "./infrastructure/audit-log.adapter";
import { BostaCarrierAdapter } from "./infrastructure/bosta-carrier.adapter";
import { BostaCatalogCache } from "./infrastructure/bosta-catalog-cache";
import { BostaHttpClient } from "./infrastructure/bosta-http-client";
import { CarrierConnectionsRepository } from "./infrastructure/carrier-connections.repository";
import { CarrierRouter } from "./infrastructure/carrier-router";
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
 * {@link CarrierPort} is bound to {@link CarrierRouter}, which dispatches
 * per company between {@link ManualCarrierAdapter} (default) and
 * {@link BostaCarrierAdapter} (once connected via settings) — the interface
 * itself never changed to add Bosta (decision D1). The three-layer resolver + guards come from the global
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
    ManualCarrierAdapter,
    BostaCarrierAdapter,
    { provide: BOSTA_CATALOG_CACHE, useClass: BostaCatalogCache },
    {
      provide: BOSTA_HTTP_CLIENT,
      useFactory: (config: InjectedAppConfig) => new BostaHttpClient(config.shipping.bostaBaseUrl),
      inject: [APP_CONFIG],
    },
    { provide: CARRIER_PORT, useClass: CarrierRouter },
    { provide: SHIPPING_REPOSITORY, useClass: ShippingRepository },
    { provide: SHIPPING_AUDIT, useClass: ShippingAuditLogAdapter },
    { provide: WEBHOOK_INBOX, useClass: WebhookInboxRepository },
    { provide: CARRIER_CONNECTIONS_REPOSITORY, useClass: CarrierConnectionsRepository },
  ],
  exports: [ShippingService],
})
export class ShippingModule {}
