import { Inject, Injectable } from "@nestjs/common";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import {
  CUSTOMERS_DIRECTORY,
  type CustomersDirectoryPort,
} from "../../../shared/contracts/customers-directory.port";
import {
  INVENTORY_ADJUSTMENT,
  type InventoryAdjustmentPort,
} from "../../../shared/contracts/inventory-adjustment.port";
import {
  ORDERS_INGESTION,
  type OrdersIngestionItem,
  type OrdersIngestionPort,
} from "../../../shared/contracts/orders-ingestion.port";
import {
  PRODUCTS_CATALOG,
  type ProductsCatalogPort,
} from "../../../shared/contracts/products-catalog.port";
import { AppErrors, AppException } from "../../../shared/errors/app-exception";
import type {
  NormalizedCustomer,
  NormalizedOrder,
  NormalizedProduct,
} from "../domain/storefront-adapter.port";
import {
  STOREFRONT_ADAPTER_RESOLVER,
  type StorefrontAdapterResolverPort,
} from "../domain/storefront-adapter-resolver.port";
import type { ResolvedStorefrontConnection } from "../domain/storefront-connection.entity";
import {
  STOREFRONT_CONNECTIONS_REPOSITORY,
  type StorefrontConnectionsRepositoryPort,
} from "../domain/storefront-connections-repository.port";
import {
  STOREFRONT_WEBHOOK_INBOX,
  type StorefrontWebhookInboxPort,
} from "../domain/storefront-webhook-inbox.port";
import { NotReprocessableError, UnknownSkuError } from "../domain/storefront.errors";

/** A system-actor session id; never checked, only satisfies the `RequestPrincipal` shape. */
const SYSTEM_SESSION = "storefront-sync";

/** What an ingestion route returns for one event. */
export interface IngestResult {
  readonly entityId: string;
  readonly status: "created" | "updated" | "duplicate";
}

/**
 * Orchestrates the two ingestion pipelines (storefront-integration §D4/D5/D6):
 * payload → {@link StorefrontAdapterPort} → generic contract → the SAME
 * write paths a JWT-authenticated caller uses (`OrdersService.create`,
 * `ProductsService.create`/`createVariant`/`updateVariant`,
 * `InventoryService.adjust`, `CustomersService.list`/`create`). This class
 * owns exactly three things: connection/inbox bookkeeping, payload→command
 * mapping, and system-actor attribution — no order/product/stock/customer
 * business rule is reimplemented here.
 */
@Injectable()
export class StorefrontIngestionService {
  constructor(
    @Inject(STOREFRONT_WEBHOOK_INBOX) private readonly inbox: StorefrontWebhookInboxPort,
    @Inject(STOREFRONT_ADAPTER_RESOLVER) private readonly adapters: StorefrontAdapterResolverPort,
    @Inject(STOREFRONT_CONNECTIONS_REPOSITORY)
    private readonly connections: StorefrontConnectionsRepositoryPort,
    @Inject(ORDERS_INGESTION) private readonly orders: OrdersIngestionPort,
    @Inject(PRODUCTS_CATALOG) private readonly products: ProductsCatalogPort,
    @Inject(INVENTORY_ADJUSTMENT) private readonly inventory: InventoryAdjustmentPort,
    @Inject(CUSTOMERS_DIRECTORY) private readonly customers: CustomersDirectoryPort,
  ) {}

  async ingestOrder(connection: ResolvedStorefrontConnection, raw: unknown): Promise<IngestResult> {
    const normalized = this.adapters.resolve(connection.platform).parseOrder(raw);
    this.assertOrderShape(normalized);
    return this.ingest(connection, "order", normalized.externalId, raw, () =>
      this.processOrder(connection, normalized),
    );
  }

  async ingestProduct(
    connection: ResolvedStorefrontConnection,
    raw: unknown,
  ): Promise<IngestResult> {
    const normalized = this.adapters.resolve(connection.platform).parseProduct(raw);
    this.assertProductShape(normalized);
    return this.ingest(connection, "product", normalized.externalId, raw, () =>
      this.processProduct(connection, normalized),
    );
  }

  /** Re-run one `failed` event on demand (management §6.1 reprocess route). */
  async reprocessEvent(
    principal: RequestPrincipal,
    connectionId: string,
    eventId: string,
  ): Promise<IngestResult> {
    const companyId = this.requireTenant(principal);
    const event = await this.inbox.findById(companyId, eventId);
    if (event === null || event.connectionId !== connectionId) {
      throw AppErrors.notFound("Event not found.");
    }
    if (event.status !== "failed") throw new NotReprocessableError();
    const payload = await this.inbox.getPayload(companyId, eventId);
    const connection = await this.connections.findById(companyId, connectionId);
    if (connection === null) throw AppErrors.notFound("Connection not found.");
    await this.inbox.incrementAttempt(companyId, eventId);
    const resolved: ResolvedStorefrontConnection = {
      connectionId,
      companyId,
      platform: connection.platform,
      defaultWarehouseId: connection.defaultWarehouseId,
      actorId: principal.userId,
    };
    const adapter = this.adapters.resolve(resolved.platform);
    const run =
      event.eventType === "order"
        ? () => this.processOrder(resolved, adapter.parseOrder(payload))
        : () => this.processProduct(resolved, adapter.parseProduct(payload));
    try {
      const entityId = await run();
      await this.inbox.markProcessed(companyId, eventId, entityId);
      return { entityId, status: "updated" };
    } catch (error) {
      await this.inbox.markFailed(companyId, eventId, this.errorMessage(error));
      throw error;
    }
  }

  // ---- internals -----------------------------------------------------------

  private async ingest(
    connection: ResolvedStorefrontConnection,
    eventType: "order" | "product",
    externalId: string,
    raw: unknown,
    run: () => Promise<string>,
  ): Promise<IngestResult> {
    const { event, enqueued } = await this.inbox.enqueue(
      connection.companyId,
      connection.connectionId,
      eventType,
      externalId,
      raw,
    );
    if (!enqueued) {
      // D7: a re-sent event is a no-op once processed; a still-pending/failed
      // row (e.g. the SKU didn't exist yet) is retried in place.
      if (event.status === "processed" && event.internalEntityId !== null) {
        return { entityId: event.internalEntityId, status: "duplicate" };
      }
      await this.inbox.incrementAttempt(connection.companyId, event.id);
    }
    try {
      const entityId = await run();
      await this.inbox.markProcessed(connection.companyId, event.id, entityId);
      await this.connections.touchLastEventAt(connection.companyId, connection.connectionId);
      return { entityId, status: enqueued ? "created" : "updated" };
    } catch (error) {
      await this.inbox.markFailed(connection.companyId, event.id, this.errorMessage(error));
      await this.connections.touchLastEventAt(connection.companyId, connection.connectionId);
      throw error;
    }
  }

  private async processOrder(
    connection: ResolvedStorefrontConnection,
    normalized: NormalizedOrder,
  ): Promise<string> {
    const principal = this.systemPrincipal(connection);
    const items: OrdersIngestionItem[] = [];
    for (const line of normalized.items) {
      const variant = await this.products.findVariantBySku(principal, line.sku);
      if (variant === null) throw new UnknownSkuError(line.sku);
      items.push({ variantId: variant.id, quantity: line.quantity, price: line.unitPriceMinor });
    }
    const customerId = await this.resolveCustomer(principal, normalized.customer);
    const { order } = await this.orders.create(principal, {
      customerId,
      items,
      ...(connection.defaultWarehouseId === null
        ? {}
        : { warehouseId: connection.defaultWarehouseId }),
      ...(normalized.notes === undefined ? {} : { notes: normalized.notes }),
    });
    return order.id;
  }

  private async processProduct(
    connection: ResolvedStorefrontConnection,
    normalized: NormalizedProduct,
  ): Promise<string> {
    const principal = this.systemPrincipal(connection);
    // Upsert keyed on `sku` (unique per company — storefront-integration §7
    // deviation: no `external_id` column exists on products/variants, so sku
    // alone is the stable match key; see the final report for this deviation).
    const existing = await this.products.findVariantBySku(principal, normalized.sku);
    let productId: string;
    let variantId: string;
    if (existing !== null) {
      productId = existing.productId;
      variantId = existing.id;
      await this.products.update(principal, productId, {
        name: normalized.name,
        ...(normalized.description === undefined ? {} : { description: normalized.description }),
      });
      await this.products.updateVariant(principal, productId, variantId, {
        name: normalized.name,
        sku: normalized.sku,
        ...(normalized.barcode === undefined ? {} : { barcode: normalized.barcode }),
        sellingPriceMinor: normalized.priceMinor,
        ...(normalized.active === undefined ? {} : { active: normalized.active }),
      });
    } else {
      const product = await this.products.create(principal, {
        name: normalized.name,
        ...(normalized.description === undefined ? {} : { description: normalized.description }),
      });
      productId = product.id;
      const variant = await this.products.createVariant(principal, productId, {
        name: normalized.name,
        sku: normalized.sku,
        ...(normalized.barcode === undefined ? {} : { barcode: normalized.barcode }),
        sellingPriceMinor: normalized.priceMinor,
      });
      variantId = variant.id;
    }

    await this.syncStock(principal, connection, variantId, normalized);
    return productId;
  }

  /** Absolute stock quantity → a signed adjustment via the existing atomic path (D5). */
  private async syncStock(
    principal: RequestPrincipal,
    connection: ResolvedStorefrontConnection,
    variantId: string,
    normalized: NormalizedProduct,
  ): Promise<void> {
    const warehouseId = await this.resolveWarehouseId(principal, connection);
    const page = await this.inventory.listStock(principal, {
      warehouseId,
      variantId,
      limit: "1",
    });
    const onHand = page.data[0]?.onHand ?? 0;
    const delta = normalized.stockQuantity - onHand;
    if (delta === 0) return;
    await this.inventory.adjust(principal, {
      warehouseId,
      variantId,
      quantityDelta: delta,
      reason: "storefront_sync",
      note: `Storefront sync (externalId=${normalized.externalId})`,
    });
  }

  private async resolveWarehouseId(
    principal: RequestPrincipal,
    connection: ResolvedStorefrontConnection,
  ): Promise<string> {
    if (connection.defaultWarehouseId !== null) return connection.defaultWarehouseId;
    const page = await this.inventory.listWarehouses(principal, { limit: "100", active: "true" });
    const fallback = page.data.find((w) => w.isDefault) ?? page.data[0];
    if (fallback === undefined) {
      throw AppErrors.unprocessable("No warehouse is available to sync stock into.");
    }
    return fallback.id;
  }

  /** Find-or-create by phone, reusing the existing E.164/blind-index path (D6). */
  private async resolveCustomer(
    principal: RequestPrincipal,
    customer: NormalizedCustomer,
  ): Promise<string> {
    const existing = await this.customers.list(principal, { q: customer.phone, limit: "1" });
    const found = existing.data[0];
    if (found !== undefined) return found.id;
    try {
      const { customer: created } = await this.customers.create(principal, {
        name: customer.name,
        phone: customer.phone,
        ...(customer.email === undefined ? {} : { email: customer.email }),
      });
      return created.id;
    } catch (error) {
      // Lost a create race against another concurrent order for the same
      // phone: the winner's row is what we want, not a hard failure.
      if (error instanceof AppException) {
        const payload = error.getResponse() as { code?: string };
        if (payload.code === "CONFLICT") {
          const retry = await this.customers.list(principal, { q: customer.phone, limit: "1" });
          const winner = retry.data[0];
          if (winner !== undefined) return winner.id;
        }
      }
      throw error;
    }
  }

  private systemPrincipal(connection: ResolvedStorefrontConnection): RequestPrincipal {
    if (connection.actorId === null) {
      throw AppErrors.unprocessable(
        "This connection has no attributable admin (its creator's account was removed). Rotate or recreate the connection.",
      );
    }
    return {
      userId: connection.actorId,
      sessionId: SYSTEM_SESSION,
      companyId: connection.companyId,
    };
  }

  private requireTenant(principal: RequestPrincipal): string {
    if (principal.companyId === null) throw AppErrors.forbidden("Select an active company first.");
    return principal.companyId;
  }

  private assertOrderShape(order: NormalizedOrder): void {
    if (typeof order.externalId !== "string" || order.externalId.length === 0) {
      throw AppErrors.badRequest("externalId is required.");
    }
    if (!Array.isArray(order.items) || order.items.length === 0) {
      throw AppErrors.badRequest("items must be a non-empty array.");
    }
  }

  private assertProductShape(product: NormalizedProduct): void {
    if (typeof product.externalId !== "string" || product.externalId.length === 0) {
      throw AppErrors.badRequest("externalId is required.");
    }
    if (typeof product.sku !== "string" || product.sku.length === 0) {
      throw AppErrors.badRequest("sku is required.");
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof UnknownSkuError) return error.message;
    if (error instanceof AppException) {
      const payload = error.getResponse() as { message?: string };
      return payload.message ?? "Processing failed.";
    }
    if (error instanceof Error) return error.message;
    return "Processing failed.";
  }
}
