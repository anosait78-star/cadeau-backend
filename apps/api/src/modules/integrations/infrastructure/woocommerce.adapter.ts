import { Injectable } from "@nestjs/common";
import type {
  NormalizedCustomer,
  NormalizedOrder,
  NormalizedOrderItem,
  NormalizedProduct,
  StorefrontAdapterPort,
} from "../domain/storefront-adapter.port";
import { StorefrontPayloadMappingError } from "../domain/storefront.errors";

type JsonRecord = Record<string, unknown>;

/**
 * Translates a raw WooCommerce REST webhook payload (`order.created`,
 * `order.updated`, `product.created`, `product.updated` — WooCommerce's own
 * Order/Product resource shape, unmodified) into this system's generic
 * contract (`NormalizedOrder`/`NormalizedProduct`, storefront-integration
 * §D8). Reused verbatim once parsed: `StorefrontIngestionService` calls the
 * exact same `OrdersService`/`ProductsService`/`InventoryService`/
 * `CustomersService` write paths a `GenericJsonAdapter`-fed request would.
 *
 * WooCommerce's payload carries fields the generic contract has no home for
 * (order-level `discount_total`, `shipping_total`, `payment_method`,
 * `total`) — deliberately **not** mapped. The reused `OrdersService.create`
 * computes the order's total from item price × quantity itself (D4: no
 * duplicated business logic), so WooCommerce's own stated total is never the
 * source of truth here; a line's *unit* price is derived from
 * `line_items[].total` (WooCommerce's post-line-discount, pre-tax figure)
 * divided by quantity, which is what actually reaches the CRM order. The raw
 * payload is still preserved untouched in `storefront_webhook_events.payload`
 * for audit/debugging.
 *
 * Two WooCommerce behaviors are explicitly out of scope for v1 and fail the
 * event with a clear, reprocessable reason rather than silently guessing:
 *  - **Variable products** (`type: "variable"`): the webhook payload's
 *    `variations` field is only an array of child IDs, not full variation
 *    data — mapping it would need N additional API calls this inbound-only,
 *    webhook-driven design has no way to make. Matches the design's existing
 *    v1 exclusion of multi-variant nested payloads
 *    (storefront-integration-plan.md §3).
 *  - **Unmanaged stock** (`manage_stock: false`, or a null `stock_quantity`):
 *    there is no reliable "absolute on-hand" figure to sync, and guessing
 *    (e.g. defaulting to 0) would silently corrupt real inventory through
 *    the existing adjustment path (D5) — so the event fails instead.
 */
@Injectable()
export class WooCommerceAdapter implements StorefrontAdapterPort {
  parseOrder(raw: unknown): NormalizedOrder {
    const order = this.asRecord(raw, "WooCommerce order");
    const externalId = this.requireExternalId(order, "WooCommerce order");
    const items = this.parseLineItems(order, externalId);
    const customer = this.parseCustomer(order, externalId);
    const currency = order["currency"];
    const note = order["customer_note"];
    return {
      externalId,
      placedAt: this.parseDate(order, ["date_created_gmt", "date_created", "date_paid"]),
      customer,
      items,
      ...(typeof currency === "string" && currency.length > 0 ? { currency } : {}),
      notes: typeof note === "string" && note.length > 0 ? note : null,
    };
  }

  parseProduct(raw: unknown): NormalizedProduct {
    const product = this.asRecord(raw, "WooCommerce product");
    const externalId = this.requireExternalId(product, "WooCommerce product");

    if (product["type"] === "variable") {
      throw new StorefrontPayloadMappingError(
        `WooCommerce product ${externalId}: variable products (multiple variations) are not ` +
          "supported in this integration — the webhook payload only lists variation ids, not " +
          "their price/stock/sku. Sync this product's simple variant(s) individually, or contact " +
          "support if variable-product sync is required.",
      );
    }

    const sku = this.requireNonEmptyString(product, "sku", `WooCommerce product ${externalId}`);
    const name = this.requireNonEmptyString(product, "name", `WooCommerce product ${externalId}`);
    const description =
      this.optionalString(product, "description") ??
      this.optionalString(product, "short_description");
    const priceMinor = this.parsePrice(product, externalId);
    const stockQuantity = this.parseStockQuantity(product, externalId);
    const active = product["status"] === "publish";

    return {
      externalId,
      name,
      ...(description !== undefined && description.length > 0 ? { description } : {}),
      sku,
      priceMinor,
      stockQuantity,
      active,
    };
  }

  // ---- order helpers ---------------------------------------------------

  private parseLineItems(order: JsonRecord, externalId: string): NormalizedOrderItem[] {
    const raw = order["line_items"];
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new StorefrontPayloadMappingError(
        `WooCommerce order ${externalId}: has no line_items to sync.`,
      );
    }
    return raw.map((line, index) => this.parseLineItem(line, externalId, index));
  }

  private parseLineItem(raw: unknown, orderExternalId: string, index: number): NormalizedOrderItem {
    const context = `WooCommerce order ${orderExternalId} line item #${index + 1}`;
    const line = this.asRecord(raw, context);
    const sku = this.requireNonEmptyString(line, "sku", context);
    const quantity = line["quantity"];
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
      throw new StorefrontPayloadMappingError(
        `${context}: expected a positive integer quantity, got ${JSON.stringify(quantity)}.`,
      );
    }
    // `total` is WooCommerce's post-line-discount, pre-tax figure for the
    // whole line — dividing by quantity yields the effective unit price
    // after any line-level discount, without inventing an order-level
    // discount concept the generic contract doesn't have (see class docs).
    const lineTotal = line["total"] ?? line["subtotal"];
    if (lineTotal === undefined || lineTotal === null) {
      throw new StorefrontPayloadMappingError(`${context}: missing total/subtotal.`);
    }
    const totalMinor = this.toMinorUnits(lineTotal, context);
    const vendorExternalId = this.parseVendorExternalId(line);
    return {
      sku,
      quantity,
      unitPriceMinor: Math.round(totalMinor / quantity),
      ...(vendorExternalId !== undefined ? { vendorExternalId } : {}),
    };
  }

  /**
   * WCFM marketplace vendor id for one order line (multi-vendor discovery,
   * 2026-08-10): `line_items[].meta_data[]` carries a `_vendor_id` entry
   * whose `value` is the vendor's WordPress user id as a string — confirmed
   * against real production order data (WooCommerce `/wc/v3/orders`
   * response, the exact shape webhooks deliver). `undefined` — never a
   * thrown error — when absent: a purely non-multi-vendor order (no line
   * carries `_vendor_id` at all) must keep working exactly as before: this
   * is a translation step only, not the place that decides whether a
   * missing vendor id is fatal (that judgment needs to see the *whole*
   * order, made by `StorefrontIngestionService`, D4).
   */
  private parseVendorExternalId(line: JsonRecord): string | undefined {
    const metaData = line["meta_data"];
    if (!Array.isArray(metaData)) return undefined;
    for (const entry of metaData) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as JsonRecord;
      if (record["key"] !== "_vendor_id") continue;
      const value = record["value"];
      if (typeof value === "string" && value.trim().length > 0) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
    return undefined;
  }

  private parseCustomer(order: JsonRecord, externalId: string): NormalizedCustomer {
    const billing = this.asRecord(
      order["billing"] ?? {},
      `WooCommerce order ${externalId} billing`,
    );
    const shipping = this.asRecord(
      order["shipping"] ?? {},
      `WooCommerce order ${externalId} shipping`,
    );
    const name = this.fullName(billing) ?? this.fullName(shipping);
    if (name === undefined) {
      throw new StorefrontPayloadMappingError(
        `WooCommerce order ${externalId}: billing/shipping name is missing.`,
      );
    }
    const phoneRaw =
      this.optionalString(billing, "phone") ?? this.optionalString(shipping, "phone");
    if (phoneRaw === undefined || phoneRaw.trim().length === 0) {
      throw new StorefrontPayloadMappingError(
        `WooCommerce order ${externalId}: billing.phone (and shipping.phone) are both missing — ` +
          "a phone number is required to match/create the customer.",
      );
    }
    const email = this.optionalString(billing, "email");
    return { name, phone: phoneRaw.trim(), ...(email !== undefined ? { email } : {}) };
  }

  private fullName(record: JsonRecord): string | undefined {
    const first = this.optionalString(record, "first_name") ?? "";
    const last = this.optionalString(record, "last_name") ?? "";
    const full = `${first} ${last}`.trim();
    return full.length > 0 ? full : undefined;
  }

  private parseDate(order: JsonRecord, keys: readonly string[]): string {
    for (const key of keys) {
      const value = order[key];
      if (typeof value === "string" && value.length > 0) {
        // WooCommerce's `_gmt` date fields are UTC but carry no offset suffix.
        const iso = /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
        const parsed = new Date(iso);
        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
      }
    }
    return new Date().toISOString();
  }

  // ---- product helpers ---------------------------------------------------

  private parsePrice(product: JsonRecord, externalId: string): number {
    const price = product["price"];
    const regular = product["regular_price"];
    const source =
      typeof price === "string" && price.length > 0
        ? price
        : typeof regular === "string" && regular.length > 0
          ? regular
          : undefined;
    if (source === undefined) {
      throw new StorefrontPayloadMappingError(
        `WooCommerce product ${externalId}: has no price or regular_price.`,
      );
    }
    return this.toMinorUnits(source, `WooCommerce product ${externalId} price`);
  }

  private parseStockQuantity(product: JsonRecord, externalId: string): number {
    if (product["manage_stock"] === false) {
      throw new StorefrontPayloadMappingError(
        `WooCommerce product ${externalId}: stock is not managed on this product ` +
          "(manage_stock=false) — there is no absolute on-hand figure to sync. Enable stock " +
          "management on this WooCommerce product, or manage its inventory manually in the CRM.",
      );
    }
    const quantity = product["stock_quantity"];
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 0) {
      throw new StorefrontPayloadMappingError(
        `WooCommerce product ${externalId}: expected a non-negative integer stock_quantity, got ` +
          `${JSON.stringify(quantity)}.`,
      );
    }
    return quantity;
  }

  // ---- shared primitives ---------------------------------------------------

  private asRecord(raw: unknown, context: string): JsonRecord {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new StorefrontPayloadMappingError(
        `${context}: expected a JSON object, got ${JSON.stringify(raw)}.`,
      );
    }
    return raw as JsonRecord;
  }

  private requireExternalId(record: JsonRecord, context: string): string {
    const id = record["id"];
    if (typeof id === "number" && Number.isFinite(id)) return String(id);
    if (typeof id === "string" && id.length > 0) return id;
    throw new StorefrontPayloadMappingError(`${context}: missing numeric "id".`);
  }

  private requireNonEmptyString(record: JsonRecord, key: string, context: string): string {
    const value = record[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new StorefrontPayloadMappingError(`${context}: missing required field "${key}".`);
    }
    return value.trim();
  }

  private optionalString(record: JsonRecord, key: string): string | undefined {
    const value = record[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  private toMinorUnits(value: unknown, context: string): number {
    const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (!Number.isFinite(num) || num < 0) {
      throw new StorefrontPayloadMappingError(
        `${context}: expected a non-negative price, got ${JSON.stringify(value)}.`,
      );
    }
    return Math.round(num * 100);
  }
}
