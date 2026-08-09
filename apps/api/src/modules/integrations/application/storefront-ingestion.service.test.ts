import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomersDirectoryPort } from "../../../shared/contracts/customers-directory.port";
import type { InventoryAdjustmentPort } from "../../../shared/contracts/inventory-adjustment.port";
import type { OrdersIngestionPort } from "../../../shared/contracts/orders-ingestion.port";
import type { ProductsCatalogPort } from "../../../shared/contracts/products-catalog.port";
import { AppErrors, AppException } from "../../../shared/errors/app-exception";
import type { StorefrontAdapterResolverPort } from "../domain/storefront-adapter-resolver.port";
import type { StorefrontAdapterPort } from "../domain/storefront-adapter.port";
import type { ResolvedStorefrontConnection } from "../domain/storefront-connection.entity";
import type { StorefrontConnectionsRepositoryPort } from "../domain/storefront-connections-repository.port";
import type { StorefrontWebhookInboxPort } from "../domain/storefront-webhook-inbox.port";
import { UnknownSkuError } from "../domain/storefront.errors";
import { StorefrontIngestionService } from "./storefront-ingestion.service";

const CONNECTION: ResolvedStorefrontConnection = {
  connectionId: "conn-1",
  companyId: "co-1",
  platform: "generic",
  defaultWarehouseId: "wh-1",
  actorId: "user-1",
};

function emptyPage<T>(): { data: T[]; page: { limit: number; nextCursor: null; hasMore: false } } {
  return { data: [], page: { limit: 25, nextCursor: null, hasMore: false } };
}

function makeHarness() {
  const inbox = {
    enqueue: vi.fn(),
    markProcessed: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn(),
    getPayload: vi.fn(),
    incrementAttempt: vi.fn().mockResolvedValue(undefined),
    list: vi.fn(),
  };
  const adapter: StorefrontAdapterPort = {
    parseOrder: vi.fn((raw) => raw) as StorefrontAdapterPort["parseOrder"],
    parseProduct: vi.fn((raw) => raw) as StorefrontAdapterPort["parseProduct"],
  };
  const adapters: StorefrontAdapterResolverPort = { resolve: vi.fn().mockReturnValue(adapter) };
  const connections = {
    list: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    rotateKey: vi.fn(),
    revoke: vi.fn(),
    findActiveByKeyPrefix: vi.fn(),
    touchLastEventAt: vi.fn().mockResolvedValue(undefined),
  };
  const orders = { create: vi.fn() };
  const products = {
    findVariantBySku: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    createVariant: vi.fn(),
    updateVariant: vi.fn(),
  };
  const inventory = { listStock: vi.fn(), listWarehouses: vi.fn(), adjust: vi.fn() };
  const customers = { list: vi.fn(), create: vi.fn() };

  const service = new StorefrontIngestionService(
    inbox as unknown as StorefrontWebhookInboxPort,
    adapters,
    connections as unknown as StorefrontConnectionsRepositoryPort,
    orders as unknown as OrdersIngestionPort,
    products as unknown as ProductsCatalogPort,
    inventory as unknown as InventoryAdjustmentPort,
    customers as unknown as CustomersDirectoryPort,
  );
  return { service, inbox, adapter, adapters, connections, orders, products, inventory, customers };
}

const ORDER_PAYLOAD = {
  externalId: "ext-order-1",
  placedAt: "2026-08-08T10:00:00Z",
  customer: { name: "Ahmed", phone: "+201001234567" },
  items: [{ sku: "SKU-1", quantity: 2, unitPriceMinor: 15000 }],
};

const PRODUCT_PAYLOAD = {
  externalId: "ext-product-1",
  name: "Mug",
  sku: "SKU-1",
  priceMinor: 15000,
  stockQuantity: 10,
};

describe("StorefrontIngestionService.ingestOrder", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  it("creates an order end-to-end via the reused ports: resolves sku, finds/creates the customer, calls orders.create", async () => {
    h.inbox.enqueue.mockResolvedValue({
      event: { id: "evt-1", status: "pending", internalEntityId: null },
      enqueued: true,
    });
    h.products.findVariantBySku.mockResolvedValue({ id: "variant-1", productId: "product-1" });
    h.customers.list.mockResolvedValue(emptyPage());
    h.customers.create.mockResolvedValue({ customer: { id: "cust-1" }, replayed: false });
    h.orders.create.mockResolvedValue({ order: { id: "order-1" }, replayed: false });

    const result = await h.service.ingestOrder(CONNECTION, ORDER_PAYLOAD);

    expect(result).toEqual({ entityId: "order-1", status: "created" });
    expect(h.products.findVariantBySku).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", companyId: "co-1" }),
      "SKU-1",
    );
    expect(h.customers.list).toHaveBeenCalledWith(expect.anything(), {
      q: "+201001234567",
      limit: "1",
    });
    expect(h.customers.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "Ahmed", phone: "+201001234567" }),
    );
    expect(h.orders.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        customerId: "cust-1",
        warehouseId: "wh-1",
        items: [{ variantId: "variant-1", quantity: 2, price: 15000 }],
      }),
    );
    expect(h.inbox.markProcessed).toHaveBeenCalledWith("co-1", "evt-1", "order-1");
    expect(h.connections.touchLastEventAt).toHaveBeenCalledWith("co-1", "conn-1");
  });

  it("reuses an existing customer found by phone instead of creating a duplicate", async () => {
    h.inbox.enqueue.mockResolvedValue({
      event: { id: "evt-1", status: "pending", internalEntityId: null },
      enqueued: true,
    });
    h.products.findVariantBySku.mockResolvedValue({ id: "variant-1", productId: "product-1" });
    h.customers.list.mockResolvedValue({ data: [{ id: "existing-cust" }], page: emptyPage().page });
    h.orders.create.mockResolvedValue({ order: { id: "order-1" }, replayed: false });

    await h.service.ingestOrder(CONNECTION, ORDER_PAYLOAD);

    expect(h.customers.create).not.toHaveBeenCalled();
    expect(h.orders.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ customerId: "existing-cust" }),
    );
  });

  it("marks the event failed and rethrows when a line's sku is unknown", async () => {
    h.inbox.enqueue.mockResolvedValue({
      event: { id: "evt-1", status: "pending", internalEntityId: null },
      enqueued: true,
    });
    h.products.findVariantBySku.mockResolvedValue(null);

    await expect(h.service.ingestOrder(CONNECTION, ORDER_PAYLOAD)).rejects.toBeInstanceOf(
      UnknownSkuError,
    );
    expect(h.inbox.markFailed).toHaveBeenCalledWith(
      "co-1",
      "evt-1",
      expect.stringContaining("SKU-1"),
    );
    expect(h.orders.create).not.toHaveBeenCalled();
  });

  it("returns duplicate without reprocessing when the event was already processed", async () => {
    h.inbox.enqueue.mockResolvedValue({
      event: { id: "evt-1", status: "processed", internalEntityId: "order-existing" },
      enqueued: false,
    });

    const result = await h.service.ingestOrder(CONNECTION, ORDER_PAYLOAD);

    expect(result).toEqual({ entityId: "order-existing", status: "duplicate" });
    expect(h.orders.create).not.toHaveBeenCalled();
    expect(h.products.findVariantBySku).not.toHaveBeenCalled();
  });

  it("retries a previously-failed event in place rather than treating it as a duplicate", async () => {
    h.inbox.enqueue.mockResolvedValue({
      event: { id: "evt-1", status: "failed", internalEntityId: null },
      enqueued: false,
    });
    h.products.findVariantBySku.mockResolvedValue({ id: "variant-1", productId: "product-1" });
    h.customers.list.mockResolvedValue({ data: [{ id: "cust-1" }], page: emptyPage().page });
    h.orders.create.mockResolvedValue({ order: { id: "order-1" }, replayed: false });

    const result = await h.service.ingestOrder(CONNECTION, ORDER_PAYLOAD);

    expect(result).toEqual({ entityId: "order-1", status: "updated" });
    expect(h.inbox.incrementAttempt).toHaveBeenCalledWith("co-1", "evt-1");
  });

  it("resolves a create-race on the customer phone by finding the winner instead of failing", async () => {
    h.inbox.enqueue.mockResolvedValue({
      event: { id: "evt-1", status: "pending", internalEntityId: null },
      enqueued: true,
    });
    h.products.findVariantBySku.mockResolvedValue({ id: "variant-1", productId: "product-1" });
    h.customers.list
      .mockResolvedValueOnce(emptyPage())
      .mockResolvedValueOnce({ data: [{ id: "winner-cust" }], page: emptyPage().page });
    h.customers.create.mockRejectedValue(AppErrors.conflict("Phone already in use."));
    h.orders.create.mockResolvedValue({ order: { id: "order-1" }, replayed: false });

    await h.service.ingestOrder(CONNECTION, ORDER_PAYLOAD);

    expect(h.orders.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ customerId: "winner-cust" }),
    );
  });

  it("fails closed when the connection has no attributable actor", async () => {
    h.inbox.enqueue.mockResolvedValue({
      event: { id: "evt-1", status: "pending", internalEntityId: null },
      enqueued: true,
    });
    const orphaned: ResolvedStorefrontConnection = { ...CONNECTION, actorId: null };

    await expect(h.service.ingestOrder(orphaned, ORDER_PAYLOAD)).rejects.toBeInstanceOf(
      AppException,
    );
    expect(h.inbox.markFailed).toHaveBeenCalled();
  });
});

describe("StorefrontIngestionService.ingestProduct", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  it("creates a new product+variant and syncs stock via an inventory adjustment when no existing sku matches", async () => {
    h.inbox.enqueue.mockResolvedValue({
      event: { id: "evt-1", status: "pending", internalEntityId: null },
      enqueued: true,
    });
    h.products.findVariantBySku.mockResolvedValue(null);
    h.products.create.mockResolvedValue({ id: "product-1" });
    h.products.createVariant.mockResolvedValue({ id: "variant-1", productId: "product-1" });
    h.inventory.listStock.mockResolvedValue(emptyPage());
    h.inventory.adjust.mockResolvedValue(undefined);

    const result = await h.service.ingestProduct(CONNECTION, PRODUCT_PAYLOAD);

    expect(result).toEqual({ entityId: "product-1", status: "created" });
    expect(h.products.create).toHaveBeenCalledWith(expect.anything(), { name: "Mug" });
    expect(h.products.createVariant).toHaveBeenCalledWith(
      expect.anything(),
      "product-1",
      expect.objectContaining({ sku: "SKU-1", sellingPriceMinor: 15000 }),
    );
    // averageCost is never referenced anywhere in the ingestion pipeline.
    expect(h.products.createVariant.mock.calls[0]?.[2]).not.toHaveProperty("averageCost");
    expect(h.inventory.adjust).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        warehouseId: "wh-1",
        variantId: "variant-1",
        quantityDelta: 10,
        reason: "storefront_sync",
      }),
    );
  });

  it("updates an existing product+variant when the sku already resolves, and skips the adjustment when stock already matches", async () => {
    h.inbox.enqueue.mockResolvedValue({
      event: { id: "evt-1", status: "pending", internalEntityId: null },
      enqueued: true,
    });
    h.products.findVariantBySku.mockResolvedValue({ id: "variant-1", productId: "product-1" });
    h.products.update.mockResolvedValue({ id: "product-1" });
    h.products.updateVariant.mockResolvedValue({ id: "variant-1", productId: "product-1" });
    h.inventory.listStock.mockResolvedValue({
      data: [{ onHand: 10 }],
      page: emptyPage().page,
    });

    const result = await h.service.ingestProduct(CONNECTION, PRODUCT_PAYLOAD);

    expect(result).toEqual({ entityId: "product-1", status: "created" });
    expect(h.products.update).toHaveBeenCalled();
    expect(h.products.updateVariant).toHaveBeenCalled();
    expect(h.inventory.adjust).not.toHaveBeenCalled();
  });

  it("falls back to the company's default warehouse when the connection has none set", async () => {
    const connectionNoWarehouse: ResolvedStorefrontConnection = {
      ...CONNECTION,
      defaultWarehouseId: null,
    };
    h.inbox.enqueue.mockResolvedValue({
      event: { id: "evt-1", status: "pending", internalEntityId: null },
      enqueued: true,
    });
    h.products.findVariantBySku.mockResolvedValue(null);
    h.products.create.mockResolvedValue({ id: "product-1" });
    h.products.createVariant.mockResolvedValue({ id: "variant-1", productId: "product-1" });
    h.inventory.listWarehouses.mockResolvedValue({
      data: [
        { id: "wh-default", isDefault: true },
        { id: "wh-other", isDefault: false },
      ],
      page: emptyPage().page,
    });
    h.inventory.listStock.mockResolvedValue(emptyPage());

    await h.service.ingestProduct(connectionNoWarehouse, PRODUCT_PAYLOAD);

    expect(h.inventory.adjust).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ warehouseId: "wh-default" }),
    );
  });
});

describe("StorefrontIngestionService.reprocessEvent", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  const principal = { userId: "admin-1", sessionId: "s", companyId: "co-1" };

  it("re-runs a failed order event and marks it processed", async () => {
    h.inbox.findById.mockResolvedValue({
      id: "evt-1",
      connectionId: "conn-1",
      eventType: "order",
      status: "failed",
    });
    h.inbox.getPayload.mockResolvedValue(ORDER_PAYLOAD);
    h.connections.findById.mockResolvedValue({ id: "conn-1", defaultWarehouseId: "wh-1" });
    h.products.findVariantBySku.mockResolvedValue({ id: "variant-1", productId: "product-1" });
    h.customers.list.mockResolvedValue({ data: [{ id: "cust-1" }], page: emptyPage().page });
    h.orders.create.mockResolvedValue({ order: { id: "order-1" }, replayed: false });

    const result = await h.service.reprocessEvent(principal, "conn-1", "evt-1");

    expect(result).toEqual({ entityId: "order-1", status: "updated" });
    expect(h.inbox.markProcessed).toHaveBeenCalledWith("co-1", "evt-1", "order-1");
  });

  it("rejects reprocessing a non-failed event", async () => {
    h.inbox.findById.mockResolvedValue({
      id: "evt-1",
      connectionId: "conn-1",
      status: "processed",
    });
    await expect(h.service.reprocessEvent(principal, "conn-1", "evt-1")).rejects.toThrow(
      "Only a failed event can be reprocessed.",
    );
  });

  it("404s when the event does not belong to the given connection", async () => {
    h.inbox.findById.mockResolvedValue({
      id: "evt-1",
      connectionId: "other-conn",
      status: "failed",
    });
    await expect(h.service.reprocessEvent(principal, "conn-1", "evt-1")).rejects.toMatchObject({
      status: 404,
    });
  });
});
