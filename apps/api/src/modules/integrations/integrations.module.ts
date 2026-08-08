import { Module } from "@nestjs/common";
import { systemClockProvider } from "../../shared/time/clock";
import { StorefrontConnectionsService } from "./application/storefront-connections.service";
import { StorefrontIngestionService } from "./application/storefront-ingestion.service";
import { STOREFRONT_ADAPTER } from "./domain/storefront-adapter.port";
import { STOREFRONT_AUDIT } from "./domain/storefront-audit.port";
import { STOREFRONT_CONNECTIONS_REPOSITORY } from "./domain/storefront-connections-repository.port";
import { STOREFRONT_WEBHOOK_INBOX } from "./domain/storefront-webhook-inbox.port";
import { StorefrontAuditLogAdapter } from "./infrastructure/audit-log.adapter";
import { GenericJsonAdapter } from "./infrastructure/generic-json.adapter";
import { integrationsPrismaClientProvider } from "./infrastructure/prisma-client.provider";
import { StorefrontConnectionsRepository } from "./infrastructure/storefront-connections.repository";
import { StorefrontWebhookInboxRepository } from "./infrastructure/storefront-webhook-inbox.repository";
import { StorefrontApiKeyGuard } from "./presentation/storefront-api-key.guard";
import { StorefrontConnectionsController } from "./presentation/storefront-connections.controller";
import { StorefrontIngestionController } from "./presentation/storefront-ingestion.controller";

/**
 * Storefront-integration feature module (composition root,
 * docs/storefront-integration-plan.md). Wires:
 *
 *  - `/v1/integrations/storefront/connections` (JWT + `integrations.manage`)
 *    to {@link StorefrontConnectionsService} and the Prisma connections
 *    repository (D1/D2: key lives on the connection, not the company).
 *  - `/v1/integrations/storefront/{orders,products}` (API-key-authenticated
 *    via {@link StorefrontApiKeyGuard}, no JWT — D3) to {@link
 *    StorefrontIngestionService}, which is the ONLY place in this module that
 *    performs a domain write — and even then only by calling
 *    `OrdersService`/`ProductsService`/`InventoryService`/`CustomersService`
 *    through their `shared/contracts` ports (`ORDERS_INGESTION`,
 *    `PRODUCTS_CATALOG`, `INVENTORY_ADJUSTMENT`, `CUSTOMERS_DIRECTORY` — each
 *    module binds `useExisting` to its own service and exports the token
 *    globally, same pattern as `AuthModule`/`SESSION_REISSUE`), never by
 *    importing those feature modules directly (architecture rule
 *    `no-cross-feature-imports`; D4: zero duplicated business logic).
 *  - {@link STOREFRONT_ADAPTER} → {@link GenericJsonAdapter}, the sole v1
 *    adapter (D8): the generic contract IS the input shape, so parsing is an
 *    identity mapping. A per-platform adapter is a later, additive peer
 *    behind the same port.
 *
 * The three-layer resolver + guards come from the global
 * {@link AccessCoreModule}; the event bus from {@link EventBusModule} — both
 * injected without an explicit import here, same as every other module.
 */
@Module({
  controllers: [StorefrontConnectionsController, StorefrontIngestionController],
  providers: [
    StorefrontConnectionsService,
    StorefrontIngestionService,
    StorefrontApiKeyGuard,
    systemClockProvider,
    integrationsPrismaClientProvider,
    { provide: STOREFRONT_CONNECTIONS_REPOSITORY, useClass: StorefrontConnectionsRepository },
    { provide: STOREFRONT_WEBHOOK_INBOX, useClass: StorefrontWebhookInboxRepository },
    { provide: STOREFRONT_AUDIT, useClass: StorefrontAuditLogAdapter },
    { provide: STOREFRONT_ADAPTER, useClass: GenericJsonAdapter },
  ],
})
export class IntegrationsModule {}
