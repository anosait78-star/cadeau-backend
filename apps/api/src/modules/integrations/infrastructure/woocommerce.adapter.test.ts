import { describe, expect, it } from "vitest";
import { StorefrontPayloadMappingError } from "../domain/storefront.errors";
import { WooCommerceAdapter } from "./woocommerce.adapter";

const adapter = new WooCommerceAdapter();

function baseOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 4321,
    status: "processing",
    currency: "EGP",
    date_created_gmt: "2026-08-08T10:00:00",
    customer_note: "Please gift-wrap",
    billing: {
      first_name: "أحمد",
      last_name: "محمد",
      phone: "01001234567",
      email: "ahmed@example.com",
    },
    shipping: { first_name: "أحمد", last_name: "محمد" },
    line_items: [{ sku: "SKU-001", quantity: 2, total: "300.00", price: "150.00" }],
    ...overrides,
  };
}

function baseProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 987,
    type: "simple",
    status: "publish",
    name: "قميص قطن",
    description: "<p>Cotton shirt</p>",
    sku: "SKU-001",
    price: "150.00",
    regular_price: "180.00",
    manage_stock: true,
    stock_quantity: 42,
    ...overrides,
  };
}

describe("WooCommerceAdapter.parseOrder — vendor id (multi-vendor discovery, 2026-08-10)", () => {
  it("extracts _vendor_id from a line item's meta_data when present", () => {
    const order = baseOrder({
      line_items: [
        {
          sku: "SKU-001",
          quantity: 1,
          total: "150.00",
          meta_data: [
            { id: 1, key: "📝 تفاصيل الطلب الخاص", value: "رانيا" },
            {
              id: 2,
              key: "_vendor_id",
              value: "1527",
              display_key: "محل",
              display_value: "The House Of RoRo",
            },
          ],
        },
      ],
    });
    expect(adapter.parseOrder(order).items[0]?.vendorExternalId).toBe("1527");
  });

  it("leaves vendorExternalId undefined when a line has no _vendor_id meta — real WooCommerce data confirmed at least one such gap", () => {
    const order = baseOrder({
      line_items: [{ sku: "SKU-001", quantity: 1, total: "150.00", meta_data: [] }],
    });
    expect(adapter.parseOrder(order).items[0]?.vendorExternalId).toBeUndefined();
  });

  it("leaves vendorExternalId undefined when the line has no meta_data at all — never throws for it", () => {
    const order = baseOrder({
      line_items: [{ sku: "SKU-001", quantity: 1, total: "150.00" }],
    });
    expect(() => adapter.parseOrder(order)).not.toThrow();
    expect(adapter.parseOrder(order).items[0]?.vendorExternalId).toBeUndefined();
  });

  it("maps each line's own vendor independently in a real multi-vendor order", () => {
    const order = baseOrder({
      line_items: [
        {
          sku: "SKU-A",
          quantity: 1,
          total: "100.00",
          meta_data: [{ id: 1, key: "_vendor_id", value: "1223", display_value: "maurice" }],
        },
        {
          sku: "SKU-B",
          quantity: 1,
          total: "50.00",
          meta_data: [{ id: 2, key: "_vendor_id", value: "37", display_value: "Crazy Shop" }],
        },
      ],
    });
    const items = adapter.parseOrder(order).items;
    expect(items[0]).toMatchObject({ sku: "SKU-A", vendorExternalId: "1223" });
    expect(items[1]).toMatchObject({ sku: "SKU-B", vendorExternalId: "37" });
  });
});

describe("WooCommerceAdapter.parseOrder", () => {
  it("maps a valid WooCommerce order to the normalized contract", () => {
    const result = adapter.parseOrder(baseOrder());
    expect(result).toEqual({
      externalId: "4321",
      placedAt: "2026-08-08T10:00:00.000Z",
      customer: { name: "أحمد محمد", phone: "01001234567", email: "ahmed@example.com" },
      items: [{ sku: "SKU-001", quantity: 2, unitPriceMinor: 15000 }],
      currency: "EGP",
      notes: "Please gift-wrap",
    });
  });

  it("throws a clear error when a line item has no sku", () => {
    const order = baseOrder({ line_items: [{ quantity: 1, total: "100.00" }] });
    expect(() => adapter.parseOrder(order)).toThrow(StorefrontPayloadMappingError);
    expect(() => adapter.parseOrder(order)).toThrow(/sku/);
  });

  it("throws a clear error when both billing and shipping name are missing", () => {
    const order = baseOrder({ billing: { phone: "01001234567" }, shipping: {} });
    expect(() => adapter.parseOrder(order)).toThrow(/name is missing/);
  });

  it("throws a clear error when both billing and shipping phone are missing", () => {
    const order = baseOrder({
      billing: { first_name: "أحمد", last_name: "محمد" },
      shipping: {},
    });
    expect(() => adapter.parseOrder(order)).toThrow(/phone/);
  });

  it("falls back to shipping.phone when billing.phone is absent", () => {
    const order = baseOrder({
      billing: { first_name: "أحمد", last_name: "محمد" },
      shipping: { phone: "01009998888" },
    });
    expect(adapter.parseOrder(order).customer.phone).toBe("01009998888");
  });

  it("maps multiple line items", () => {
    const order = baseOrder({
      line_items: [
        { sku: "SKU-001", quantity: 2, total: "300.00" },
        { sku: "SKU-002", quantity: 1, total: "50.00" },
      ],
    });
    expect(adapter.parseOrder(order).items).toEqual([
      { sku: "SKU-001", quantity: 2, unitPriceMinor: 15000 },
      { sku: "SKU-002", quantity: 1, unitPriceMinor: 5000 },
    ]);
  });

  it("derives the per-unit price from the post-discount line total, not the list price", () => {
    // 2 units, list price 150 each (300 total), but a 10% line discount brings
    // the WooCommerce `total` down to 270 — the effective unit price is 135.
    const order = baseOrder({
      line_items: [{ sku: "SKU-001", quantity: 2, price: "150.00", total: "270.00" }],
    });
    expect(adapter.parseOrder(order).items).toEqual([
      { sku: "SKU-001", quantity: 2, unitPriceMinor: 13500 },
    ]);
  });

  it("falls back to subtotal when total is absent", () => {
    const order = baseOrder({
      line_items: [{ sku: "SKU-001", quantity: 1, subtotal: "99.00" }],
    });
    expect(adapter.parseOrder(order).items[0]).toEqual({
      sku: "SKU-001",
      quantity: 1,
      unitPriceMinor: 9900,
    });
  });

  it("accepts every WooCommerce order status without special-casing it", () => {
    for (const status of [
      "pending",
      "processing",
      "on-hold",
      "completed",
      "cancelled",
      "refunded",
    ]) {
      expect(() => adapter.parseOrder(baseOrder({ status }))).not.toThrow();
    }
  });

  it("throws on a non-object payload", () => {
    expect(() => adapter.parseOrder("nope")).toThrow(StorefrontPayloadMappingError);
    expect(() => adapter.parseOrder(null)).toThrow(StorefrontPayloadMappingError);
    expect(() => adapter.parseOrder([1, 2, 3])).toThrow(StorefrontPayloadMappingError);
  });

  it("throws when line_items is empty", () => {
    expect(() => adapter.parseOrder(baseOrder({ line_items: [] }))).toThrow(/line_items/);
  });

  it("throws when the order has no id", () => {
    const order = baseOrder();
    delete order["id"];
    expect(() => adapter.parseOrder(order)).toThrow(/id/);
  });
});

describe("WooCommerceAdapter.parseProduct", () => {
  it("maps a valid simple WooCommerce product to the normalized contract", () => {
    expect(adapter.parseProduct(baseProduct())).toEqual({
      externalId: "987",
      name: "قميص قطن",
      description: "<p>Cotton shirt</p>",
      sku: "SKU-001",
      priceMinor: 15000,
      stockQuantity: 42,
      active: true,
    });
  });

  it("throws a clear error when sku is missing", () => {
    const product = baseProduct({ sku: "" });
    expect(() => adapter.parseProduct(product)).toThrow(StorefrontPayloadMappingError);
    expect(() => adapter.parseProduct(product)).toThrow(/sku/);
  });

  it("falls back to regular_price when price is empty", () => {
    const product = baseProduct({ price: "" });
    expect(adapter.parseProduct(product).priceMinor).toBe(18000);
  });

  it("throws when both price and regular_price are missing", () => {
    const product = baseProduct({ price: "", regular_price: "" });
    expect(() => adapter.parseProduct(product)).toThrow(/price/);
  });

  it("maps stock_quantity for a managed-stock product", () => {
    expect(adapter.parseProduct(baseProduct({ stock_quantity: 7 })).stockQuantity).toBe(7);
  });

  it("throws a clear, reprocessable error when stock is not managed (manage_stock=false)", () => {
    const product = baseProduct({ manage_stock: false, stock_quantity: null });
    expect(() => adapter.parseProduct(product)).toThrow(StorefrontPayloadMappingError);
    expect(() => adapter.parseProduct(product)).toThrow(/manage_stock/);
  });

  it("throws when stock is managed but stock_quantity is null/malformed", () => {
    const product = baseProduct({ manage_stock: true, stock_quantity: null });
    expect(() => adapter.parseProduct(product)).toThrow(/stock_quantity/);
  });

  it("maps status=publish to active=true and any other status to active=false", () => {
    expect(adapter.parseProduct(baseProduct({ status: "publish" })).active).toBe(true);
    expect(adapter.parseProduct(baseProduct({ status: "draft" })).active).toBe(false);
  });

  it("rejects variable products — variation data isn't in the webhook payload", () => {
    const product = baseProduct({ type: "variable" });
    expect(() => adapter.parseProduct(product)).toThrow(StorefrontPayloadMappingError);
    expect(() => adapter.parseProduct(product)).toThrow(/variable/);
  });

  it("throws on a non-object payload", () => {
    expect(() => adapter.parseProduct(42)).toThrow(StorefrontPayloadMappingError);
    expect(() => adapter.parseProduct(undefined)).toThrow(StorefrontPayloadMappingError);
  });

  it("throws when the product has no id", () => {
    const product = baseProduct();
    delete product["id"];
    expect(() => adapter.parseProduct(product)).toThrow(/id/);
  });

  it("extracts _vendor_id from the product's own meta_data when present (trusted post_author, injected by the CRM WPCode snippet)", () => {
    const product = baseProduct({
      meta_data: [{ id: 1, key: "_vendor_id", value: "1527" }],
    });
    expect(adapter.parseProduct(product).vendorExternalId).toBe("1527");
  });

  it("leaves vendorExternalId undefined when the product has no _vendor_id meta", () => {
    expect(adapter.parseProduct(baseProduct()).vendorExternalId).toBeUndefined();
  });

  it("extracts imageUrl from the first entry of images[]", () => {
    const product = baseProduct({
      images: [{ id: 1, src: "https://cadeauegypt.com/wp-content/uploads/mug.jpg" }],
    });
    expect(adapter.parseProduct(product).imageUrl).toBe(
      "https://cadeauegypt.com/wp-content/uploads/mug.jpg",
    );
  });

  it("leaves imageUrl undefined when images is empty or missing", () => {
    expect(adapter.parseProduct(baseProduct({ images: [] })).imageUrl).toBeUndefined();
    expect(adapter.parseProduct(baseProduct()).imageUrl).toBeUndefined();
  });
});
