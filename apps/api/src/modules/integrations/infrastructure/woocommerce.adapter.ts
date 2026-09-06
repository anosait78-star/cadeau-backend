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
 * (order-level `discount_total`, `payment_method`, `total`) — deliberately
 * **not** mapped. The reused `OrdersService.create` computes the order's
 * total from item price × quantity (+ `shippingFee` + gift-wrap fee — see
 * below) itself (D4: no duplicated business logic), so WooCommerce's own
 * stated `total` is never the source of truth here; a line's *unit* price is
 * derived from `line_items[].total` (WooCommerce's post-line-discount,
 * pre-tax figure) divided by quantity, which is what actually reaches the
 * CRM order. `shipping_total` (mapped to `shippingFeeMinor`) and the
 * gift-wrap `fee_lines[]` entry are the two exceptions: they ARE trusted
 * verbatim, since each is one already-final platform-computed figure with no
 * per-line CRM equivalent to derive it from. The raw payload is still
 * preserved untouched in `storefront_webhook_events.payload` for
 * audit/debugging.
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
    const shippingFeeMinor = this.parseShippingTotal(order);
    const giftWrap = this.parseGiftWrap(order);
    const paidOnline = order["date_paid"] !== null && order["date_paid"] !== undefined;
    return {
      externalId,
      placedAt: this.parseDate(order, ["date_created_gmt", "date_created", "date_paid"]),
      customer,
      items,
      ...(typeof currency === "string" && currency.length > 0 ? { currency } : {}),
      notes: typeof note === "string" && note.length > 0 ? note : null,
      ...(shippingFeeMinor !== undefined ? { shippingFeeMinor } : {}),
      ...(giftWrap !== undefined ? { giftWrap } : {}),
      paidOnline,
    };
  }

  /**
   * WooCommerce's `shipping_total` is a plain decimal string, always present
   * (defaults to `"0.00"` when the order has no shipping line) — unlike a
   * line's price, there is no per-item breakdown to derive it from, so it's
   * trusted verbatim (see class docs).
   */
  private parseShippingTotal(order: JsonRecord): number | undefined {
    const total = order["shipping_total"];
    if (total === undefined || total === null) return undefined;
    const minor = this.toMinorUnits(total, "WooCommerce order shipping_total");
    return minor > 0 ? minor : undefined;
  }

  /**
   * The gift-wrap checkout add-on (cadeauegypt.com's own WPCode snippet,
   * confirmed 2026-09-06) is added as a cart **fee**, not a line item — it
   * shows up in `fee_lines[]` with a name that always starts with "تغليف"
   * ("wrap"); the three current variants are "تغليف هدية (عادي/مميز/فاخر)"
   * but the amount (100/150/200 EGP today) is store-configurable, so only the
   * name prefix is matched, never a hardcoded amount. `undefined` when the
   * order has no such fee line (gift wrap wasn't requested) — never fatal.
   */
  private parseGiftWrap(order: JsonRecord): { feeMinor: number } | undefined {
    const feeLines = order["fee_lines"];
    if (!Array.isArray(feeLines)) return undefined;
    for (const raw of feeLines) {
      if (typeof raw !== "object" || raw === null) continue;
      const fee = raw as JsonRecord;
      const name = fee["name"];
      if (typeof name !== "string" || !name.includes("تغليف")) continue;
      const total = fee["total"];
      if (total === undefined || total === null) continue;
      return { feeMinor: this.toMinorUnits(total, "WooCommerce order gift-wrap fee_line") };
    }
    return undefined;
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
    const vendorExternalId = this.parseVendorExternalId(product);
    const imageUrl = this.parseImageUrl(product);

    return {
      externalId,
      name,
      ...(description !== undefined && description.length > 0 ? { description } : {}),
      sku,
      priceMinor,
      ...(stockQuantity !== undefined ? { stockQuantity } : {}),
      active,
      ...(vendorExternalId !== undefined ? { vendorExternalId } : {}),
      ...(imageUrl !== undefined ? { imageUrl } : {}),
    };
  }

  /**
   * WooCommerce's product `images[]` is ordered — the first entry is the
   * product's main/featured image (`/wc/v3/products` response shape).
   * `undefined` when the product has none; never fatal (storefront-sync
   * §images: a missing image is not a mapping error).
   */
  private parseImageUrl(product: JsonRecord): string | undefined {
    const images = product["images"];
    if (!Array.isArray(images) || images.length === 0) return undefined;
    const first = images[0];
    if (typeof first !== "object" || first === null) return undefined;
    const src = (first as JsonRecord)["src"];
    return typeof src === "string" && src.trim().length > 0 ? src.trim() : undefined;
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
   * WCFM marketplace vendor id (multi-vendor discovery, 2026-08-10): the
   * record's own `meta_data[]` carries a `_vendor_id` entry whose `value` is
   * the vendor's WordPress user id as a string — confirmed against real
   * production order data (WooCommerce `/wc/v3/orders` response, the exact
   * shape webhooks deliver) and reused as-is for products (`/wc/v3/products`
   * has the same `meta_data[]` shape; the CRM Storefront Webhook WPCode
   * snippet injects a trusted `_vendor_id` — sourced from `post_author` —
   * onto both). `undefined` — never a thrown error — when absent: a purely
   * non-multi-vendor order/product (no `_vendor_id` at all) must keep
   * working exactly as before: this is a translation step only, not the
   * place that decides whether a missing vendor id is fatal (that judgment
   * needs to see the *whole* order, made by `StorefrontIngestionService`,
   * D4).
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
    const address = this.parseAddress(order, billing, shipping);
    return {
      name,
      phone: this.normalizeEgyptianPhone(phoneRaw.trim()),
      ...(email !== undefined ? { email } : {}),
      ...(address !== undefined ? { address } : {}),
    };
  }

  /**
   * The delivery address. `billing.address_1`/`address_2` are WooCommerce's
   * own standard fields; `shipping.address_1` takes priority when present
   * (it's the actual delivery point). The governorate/district, however,
   * come from cadeauegypt.com's own custom checkout fields
   * (`_billing_governorate`/`_billing_area`, `_shipping_governorate`/
   * `_shipping_area`) — saved as **protected** (underscore-prefixed) order
   * meta, which WooCommerce's REST API hides by default. They only reach
   * this payload because of the additional `woocommerce_webhook_payload`
   * snippet added alongside this feature (storefront-address-sync D, agreed
   * 2026-09-06) that re-injects them into `meta_data[]` for CRM-bound order
   * webhooks specifically. `undefined` governorate/area (snippet not present,
   * or the order predates it) never fails the order — the address line alone
   * still saves.
   */
  private parseAddress(
    order: JsonRecord,
    billing: JsonRecord,
    shipping: JsonRecord,
  ): { line: string; city?: string; state?: string } | undefined {
    const shippingLine = this.addressLine(shipping);
    const billingLine = this.addressLine(billing);
    const line = shippingLine ?? billingLine;
    if (line === undefined) return undefined;
    const usingShipping = shippingLine !== undefined;
    const meta = this.metaMap(order);
    const state = usingShipping
      ? (meta.get("_shipping_governorate") ?? meta.get("_billing_governorate"))
      : meta.get("_billing_governorate");
    const city = usingShipping
      ? (meta.get("_shipping_area") ?? meta.get("_billing_area"))
      : meta.get("_billing_area");
    return {
      line,
      ...(city !== undefined ? { city } : {}),
      ...(state !== undefined ? { state } : {}),
    };
  }

  private addressLine(addr: JsonRecord): string | undefined {
    const line1 = this.optionalString(addr, "address_1");
    if (line1 === undefined) return undefined;
    const line2 = this.optionalString(addr, "address_2");
    return line2 !== undefined ? `${line1}, ${line2}` : line1;
  }

  /** Order-level `meta_data[]` as a `key -> string value` map (non-string values skipped). */
  private metaMap(order: JsonRecord): Map<string, string> {
    const map = new Map<string, string>();
    const metaData = order["meta_data"];
    if (!Array.isArray(metaData)) return map;
    for (const entry of metaData) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as JsonRecord;
      const key = record["key"];
      const value = record["value"];
      if (typeof key === "string" && typeof value === "string" && value.trim().length > 0) {
        map.set(key, value.trim());
      }
    }
    return map;
  }

  /**
   * WooCommerce checkout phone fields hold whatever the customer typed — for
   * this store (cadeauegypt.com) that's almost always a local Egyptian mobile
   * number (`01xxxxxxxxx`, 11 digits) with no country code. The CRM's phone
   * normalizer deliberately rejects bare national numbers (there's no
   * per-company default country yet — see `customers/domain/phone.ts`), so
   * left as-is every such order would fail ingestion. This adapter already
   * knows the store is Egypt-only, so it's the right place to fill in `+20`:
   * strip the leading `0` and prepend the country code. Anything else
   * (already has a `+`, a different length/shape) is passed through
   * unchanged and left for the CRM's own validation to accept or reject.
   */
  private normalizeEgyptianPhone(phone: string): string {
    return /^0\d{10}$/.test(phone) ? `+20${phone.slice(1)}` : phone;
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

  /**
   * `undefined` — never a thrown error — when WooCommerce reports
   * `manage_stock: false`: there is no absolute on-hand figure to give, but
   * that alone doesn't make the rest of the product unsyncable (name,
   * price, image, ...). `StorefrontIngestionService` skips the stock-sync
   * step entirely in that case rather than guessing (D5).
   */
  private parseStockQuantity(product: JsonRecord, externalId: string): number | undefined {
    if (product["manage_stock"] === false) {
      return undefined;
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
