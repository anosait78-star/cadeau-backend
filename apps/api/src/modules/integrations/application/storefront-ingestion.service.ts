import { Inject, Injectable } from "@nestjs/common";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import {
  CUSTOMERS_DIRECTORY,
  type CustomersDirectoryPort,
} from "../../../shared/contracts/customers-directory.port";
import {
  type CreatedWarehouse,
  INVENTORY_ADJUSTMENT,
  type InventoryAdjustmentPort,
} from "../../../shared/contracts/inventory-adjustment.port";
import {
  ORDERS_INGESTION,
  type OrdersIngestionItem,
  type OrdersIngestionPort,
} from "../../../shared/contracts/orders-ingestion.port";
import {
  type CatalogProduct,
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
import {
  VENDOR_WAREHOUSE_MAPPINGS_REPOSITORY,
  type VendorWarehouseMappingsRepositoryPort,
} from "../domain/vendor-warehouse-mappings-repository.port";
import { STOREFRONT_AUDIT, type StorefrontAuditPort } from "../domain/storefront-audit.port";
import {
  DuplicateVendorMappingError,
  MissingVendorIdError,
  NotReprocessableError,
  UnknownSkuError,
  VendorNotMappedError,
} from "../domain/storefront.errors";

/** A system-actor session id; never checked, only satisfies the `RequestPrincipal` shape. */
const SYSTEM_SESSION = "storefront-sync";

/** What an ingestion route returns for one event. */
export interface IngestResult {
  readonly entityId: string;
  readonly status: "created" | "updated" | "duplicate";
}

/** What the vendor auto-registration route returns. */
export interface VendorSyncResult {
  readonly externalVendorId: string;
  readonly warehouseId: string;
  readonly status: "created" | "existing";
}

/** Fields accepted by {@link StorefrontIngestionService.ingestVendor}. */
export interface IngestVendorInput {
  readonly externalVendorId: string;
  readonly vendorName: string;
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
    @Inject(VENDOR_WAREHOUSE_MAPPINGS_REPOSITORY)
    private readonly vendorWarehouses: VendorWarehouseMappingsRepositoryPort,
    @Inject(STOREFRONT_AUDIT) private readonly audit: StorefrontAuditPort,
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

  /**
   * Auto-register a storefront vendor as a CRM warehouse (webhook parity
   * with admin-managed mappings, 2026-08-21). Fired by the storefront's own
   * `wcfmmp_new_store_created` hook — covers both admin-added and
   * self-registered vendors, since both paths converge on that hook
   * (discovery, 2026-08-21). Idempotent: replays for an already-mapped
   * vendor (e.g. a WCFM profile update re-firing the hook) return the
   * existing mapping instead of creating a second warehouse.
   */
  async ingestVendor(
    connection: ResolvedStorefrontConnection,
    data: IngestVendorInput,
  ): Promise<VendorSyncResult> {
    const principal = this.systemPrincipal(connection);
    const existingWarehouseId = await this.vendorWarehouses.findWarehouseId(
      connection.companyId,
      connection.connectionId,
      data.externalVendorId,
    );
    if (existingWarehouseId !== null) {
      return {
        externalVendorId: data.externalVendorId,
        warehouseId: existingWarehouseId,
        status: "existing",
      };
    }
    const warehouse = await this.createWarehouseWithUniqueName(principal, data.vendorName);
    const warehouseId = await this.createMappingOrUseWinner(
      connection,
      principal,
      data.externalVendorId,
      warehouse.id,
    );
    await this.connections.touchLastEventAt(connection.companyId, connection.connectionId);
    return {
      externalVendorId: data.externalVendorId,
      warehouseId,
      status: warehouseId === warehouse.id ? "created" : "existing",
    };
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
    // Multi-vendor routing (discovery report, 2026-08-10) is entirely
    // data-driven, never configuration-driven: it activates only when the
    // order itself carries a vendor id on at least one line. A store with no
    // vendor concept (or a WooCommerce order none of whose lines carry
    // `_vendor_id`) never enters this branch — items resolve exactly as
    // before, one shared warehouse for the whole order.
    const isMultiVendor = normalized.items.some(
      (line) => line.vendorExternalId !== undefined && line.vendorExternalId.length > 0,
    );
    // Resolve EVERY line (sku → variant, and — for a multi-vendor order —
    // vendor → warehouse) before calling `orders.create`. Any failure here
    // throws before a single row is written, so a multi-vendor order with
    // one unmapped vendor never partially reserves for the others (D6:
    // atomic all-or-nothing).
    const items: OrdersIngestionItem[] = [];
    for (const line of normalized.items) {
      const variant = await this.products.findVariantBySku(principal, line.sku);
      if (variant === null) throw new UnknownSkuError(line.sku);
      let warehouseId: string | undefined;
      if (isMultiVendor) {
        if (line.vendorExternalId === undefined || line.vendorExternalId.length === 0) {
          throw new MissingVendorIdError(line.sku);
        }
        const mapped = await this.vendorWarehouses.findWarehouseId(
          connection.companyId,
          connection.connectionId,
          line.vendorExternalId,
        );
        if (mapped === null) throw new VendorNotMappedError(line.vendorExternalId);
        warehouseId = mapped;
      }
      items.push({
        variantId: variant.id,
        quantity: line.quantity,
        price: line.unitPriceMinor,
        ...(warehouseId !== undefined ? { warehouseId } : {}),
      });
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
        ...(normalized.imageUrl === undefined ? {} : { imageUrl: normalized.imageUrl }),
      });
      await this.products.updateVariant(principal, productId, variantId, {
        name: normalized.name,
        sku: normalized.sku,
        ...(normalized.barcode === undefined ? {} : { barcode: normalized.barcode }),
        sellingPriceMinor: normalized.priceMinor,
        ...(normalized.active === undefined ? {} : { active: normalized.active }),
      });
    } else {
      const { product, name } = await this.createProductWithUniqueName(principal, normalized);
      productId = product.id;
      const variant = await this.products.createVariant(principal, productId, {
        name,
        sku: normalized.sku,
        ...(normalized.barcode === undefined ? {} : { barcode: normalized.barcode }),
        sellingPriceMinor: normalized.priceMinor,
      });
      variantId = variant.id;
    }

    // No absolute figure (e.g. WooCommerce manage_stock=false) → skip
    // guessing a quantity; the catalog fields above already synced. Still
    // register the vendor's warehouse (if any) so the product isn't shown
    // as unassigned (products list warehouse column, 2026-08-11).
    if (normalized.stockQuantity !== undefined) {
      await this.syncStock(principal, connection, variantId, normalized.stockQuantity, normalized);
    } else {
      await this.registerKnownVendorWarehouse(principal, connection, variantId, normalized);
    }
    return productId;
  }

  /**
   * No absolute stock figure to sync, but the product carries a vendor id
   * that resolves to a mapped warehouse (multi-vendor routing) — register
   * presence there with a single zero-delta adjustment. Not a quantity
   * claim; purely so the product shows its warehouse instead of "none".
   * Skipped when there's no vendor id, no mapping for it, or a stock row
   * already exists (idempotent — a resync doesn't spam the adjustment
   * history with repeated zero-delta entries).
   */
  private async registerKnownVendorWarehouse(
    principal: RequestPrincipal,
    connection: ResolvedStorefrontConnection,
    variantId: string,
    normalized: NormalizedProduct,
  ): Promise<void> {
    const { vendorExternalId } = normalized;
    if (vendorExternalId === undefined || vendorExternalId.length === 0) return;
    const warehouseId = await this.vendorWarehouses.findWarehouseId(
      connection.companyId,
      connection.connectionId,
      vendorExternalId,
    );
    if (warehouseId === null) return;
    const existing = await this.inventory.listStock(principal, {
      warehouseId,
      variantId,
      limit: "1",
    });
    if (existing.data.length > 0) return;
    await this.inventory.adjust(principal, {
      warehouseId,
      variantId,
      quantityDelta: 0,
      reason: "storefront_sync",
      note:
        `Storefront sync (externalId=${normalized.externalId}): vendor known, ` +
        "no stock figure to sync — registering the warehouse only.",
    });
  }

  /**
   * `Product.name` is unique per company (D8), but a storefront's catalog has
   * no such rule — WooCommerce sellers commonly list colour/size variants as
   * separate products and leave the title identical. The first one syncs
   * fine; every later one collides. Rather than let the whole product fail
   * to sync (or relax the uniqueness constraint the rest of the CRM relies
   * on), retry once with the storefront's own external id appended — enough
   * to disambiguate without the user ever seeing a failed sync for this.
   */
  private async createProductWithUniqueName(
    principal: RequestPrincipal,
    normalized: NormalizedProduct,
  ): Promise<{ product: CatalogProduct; name: string }> {
    const input = {
      ...(normalized.description === undefined ? {} : { description: normalized.description }),
      ...(normalized.imageUrl === undefined ? {} : { imageUrl: normalized.imageUrl }),
    };
    try {
      const product = await this.products.create(principal, { ...input, name: normalized.name });
      return { product, name: normalized.name };
    } catch (error) {
      if (!this.isNameConflict(error)) throw error;
      const name = `${normalized.name} (${normalized.externalId})`;
      const product = await this.products.create(principal, { ...input, name });
      return { product, name };
    }
  }

  private isNameConflict(error: unknown): boolean {
    if (!(error instanceof AppException)) return false;
    const response = error.getResponse();
    if (typeof response !== "object" || response === null || !("code" in response)) return false;
    if ((response as { code?: unknown }).code !== "CONFLICT") return false;
    const details = (response as { details?: unknown }).details;
    return (
      Array.isArray(details) && details.some((d) => (d as { field?: unknown })?.field === "name")
    );
  }

  /**
   * A vendor's store name has no uniqueness guarantee on the storefront, but
   * `Warehouse.name` is unique per company — same disambiguation strategy as
   * {@link createProductWithUniqueName}: retry once with a numeric suffix
   * rather than fail the whole vendor registration over a name collision.
   */
  private async createWarehouseWithUniqueName(
    principal: RequestPrincipal,
    vendorName: string,
  ): Promise<CreatedWarehouse> {
    try {
      return await this.inventory.createWarehouse(principal, { name: vendorName });
    } catch (error) {
      if (!this.isNameConflict(error)) throw error;
      let suffix = 2;
      for (;;) {
        try {
          return await this.inventory.createWarehouse(principal, {
            name: `${vendorName} (${suffix})`,
          });
        } catch (retryError) {
          if (!this.isNameConflict(retryError) || suffix >= 50) throw retryError;
          suffix += 1;
        }
      }
    }
  }

  /**
   * Two concurrent auto-registrations for the same new vendor can both pass
   * the "no mapping yet" check before either commits — the DB unique
   * constraint on `(connectionId, externalVendorId)` picks one winner and
   * throws {@link DuplicateVendorMappingError} for the loser. Rather than
   * fail the loser's request (and leave its freshly-created warehouse
   * orphaned but silently unmapped), look up the winner's mapping and return
   * that — same race-recovery shape as {@link resolveCustomer}. The loser's
   * warehouse is left in place for an admin to notice/merge; harmless, not
   * silently discarded.
   */
  private async createMappingOrUseWinner(
    connection: ResolvedStorefrontConnection,
    principal: RequestPrincipal,
    externalVendorId: string,
    warehouseId: string,
  ): Promise<string> {
    try {
      const mapping = await this.vendorWarehouses.create(
        { companyId: connection.companyId, actorId: principal.userId },
        { connectionId: connection.connectionId, externalVendorId, warehouseId },
      );
      await this.audit.record({
        companyId: connection.companyId,
        actorId: null,
        action: "storefront_vendor_warehouse_mapping.auto_created",
        entityType: "storefront_vendor_warehouse_mapping",
        entityId: mapping.id,
        changes: { connectionId: connection.connectionId, externalVendorId, warehouseId },
      });
      return mapping.warehouseId;
    } catch (error) {
      if (!(error instanceof DuplicateVendorMappingError)) throw error;
      const winner = await this.vendorWarehouses.findWarehouseId(
        connection.companyId,
        connection.connectionId,
        externalVendorId,
      );
      if (winner === null) throw error;
      return winner;
    }
  }

  /** Absolute stock quantity → a signed adjustment via the existing atomic path (D5). */
  private async syncStock(
    principal: RequestPrincipal,
    connection: ResolvedStorefrontConnection,
    variantId: string,
    stockQuantity: number,
    normalized: NormalizedProduct,
  ): Promise<void> {
    const warehouseId = await this.resolveWarehouseId(
      principal,
      connection,
      normalized.vendorExternalId,
    );
    const page = await this.inventory.listStock(principal, {
      warehouseId,
      variantId,
      limit: "1",
    });
    const onHand = page.data[0]?.onHand ?? 0;
    const delta = stockQuantity - onHand;
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
    vendorExternalId?: string,
  ): Promise<string> {
    // A product carrying a vendor id always routes through that vendor's
    // mapping — fail closed (no silent default-warehouse fallback) exactly
    // like the order-line path, so stock is never attributed to the wrong
    // vendor's warehouse (multi-vendor discovery §D4).
    if (vendorExternalId !== undefined && vendorExternalId.length > 0) {
      const mapped = await this.vendorWarehouses.findWarehouseId(
        connection.companyId,
        connection.connectionId,
        vendorExternalId,
      );
      if (mapped === null) throw new VendorNotMappedError(vendorExternalId);
      return mapped;
    }
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
