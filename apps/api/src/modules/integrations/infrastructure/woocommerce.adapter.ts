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
 * The shape `customers/domain/phone.ts` will accept: `+`, a non-zero country
 * code, 8-15 digits total. Mirrored here (not imported — the customers module
 * is reached only through its port) so this adapter can tell whether the
 * number it produced will survive that gate, and fall back if not.
 */
const E164 = /^\+[1-9]\d{7,14}$/;

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
 * **Nothing here rejects an event any more** (2026-10-14). Mapping used to
 * fail the whole delivery over a field WooCommerce was never obliged to
 * fill, and that cost real data: products published without a sku returned
 * HTTP 500 for five consecutive deliveries on 29 Sept, WooCommerce
 * auto-disabled both product webhooks, and 65 products were then sold on the
 * storefront while the CRM had never heard of them — so every order touching
 * one was rejected in turn. The four cases that used to throw now degrade
 * instead, each in a way a human can see and correct:
 *  - **No sku** (product or order line): one is synthesized from the
 *    platform's own id (`WOO-<id>`) and flagged `skuSynthesized`. A poor
 *    match key beats no row at all.
 *  - **Variable products** (`type: "variable"`): the payload lists only
 *    child ids, so the parent syncs as a single catalogue entry at the
 *    `price` WooCommerce computed for it, with no stock figure. Orders for
 *    its children arrive bearing the *variation's* own sku, which resolves
 *    (or becomes a placeholder) on its own merits.
 *  - **No price**: zero, rather than no product.
 *  - **Unmanaged stock** (`manage_stock: false`, or a null
 *    `stock_quantity`): already handled — no absolute on-hand figure is
 *    reported, `StorefrontIngestionService` skips only the stock-sync step
 *    and never guesses a quantity (D5).
 *
 * The raw payload is kept verbatim in `storefront_webhook_events.payload`
 * either way, so a degraded mapping can always be re-read against the truth.
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
    const status = order["status"];
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
      status: typeof status === "string" && status.length > 0 ? status : "processing",
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

    // A variable product's payload lists only its children's ids, so there is
    // nothing to expand into per-variation rows here. It still syncs as one
    // catalogue entry at the price WooCommerce computed for the parent, with
    // no stock figure of its own — orders for its children arrive with the
    // variation's sku and resolve independently. Failing the event instead
    // (the v1 stance) only ever meant the product was missing when an order
    // needed it.
    const isVariable = product["type"] === "variable";

    const sku = this.resolveProductSku(product, externalId);
    const name = this.requireNonEmptyString(product, "name", `WooCommerce product ${externalId}`);
    const description =
      this.optionalString(product, "description") ??
      this.optionalString(product, "short_description");
    const priceMinor = this.parsePrice(product, externalId);
    const stockQuantity = isVariable ? undefined : this.parseStockQuantity(product);
    const active = product["status"] === "publish";
    const vendorExternalId = this.parseVendorExternalId(product);
    const imageUrl = this.parseImageUrl(product);

    return {
      externalId,
      name,
      ...(description !== undefined && description.length > 0 ? { description } : {}),
      sku: sku.value,
      ...(sku.synthesized ? { skuSynthesized: true } : {}),
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
    const sku = this.resolveLineSku(line, orderExternalId, index);
    const name = this.optionalString(line, "name");
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
      sku: sku.value,
      ...(name !== undefined ? { name } : {}),
      ...(sku.synthesized ? { skuSynthesized: true } : {}),
      quantity,
      unitPriceMinor: Math.round(totalMinor / quantity),
      ...(vendorExternalId !== undefined ? { vendorExternalId } : {}),
    };
  }

  /**
   * The line's own sku, or one synthesized from the ids WooCommerce always
   * sends — the variation's when the line is a variation, otherwise the
   * product's, and finally the line's position, which is unique within the
   * order even for a line carrying no ids at all.
   *
   * A synthesized sku will not match any catalogue variant, which is the
   * point: ingestion then creates a placeholder from the line's name rather
   * than rejecting the order (2026-10-14). It is derived only from fields
   * that are stable across re-deliveries of the same order, so a re-sent
   * `order.updated` resolves to the same placeholder, never a second one.
   */
  private resolveLineSku(
    line: JsonRecord,
    orderExternalId: string,
    index: number,
  ): { value: string; synthesized: boolean } {
    const own = this.optionalString(line, "sku");
    if (own !== undefined) return { value: own, synthesized: false };
    const variationId = this.positiveId(line["variation_id"]);
    if (variationId !== undefined) return { value: `WOO-${variationId}`, synthesized: true };
    const productId = this.positiveId(line["product_id"]);
    if (productId !== undefined) return { value: `WOO-${productId}`, synthesized: true };
    return { value: `WOO-ORDER-${orderExternalId}-L${index + 1}`, synthesized: true };
  }

  /** A WooCommerce id as a string, or `undefined` for absent/zero/garbage. */
  private positiveId(value: unknown): string | undefined {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return String(value);
    if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) return value.trim();
    return undefined;
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
    // A missing or unusable phone no longer throws (2026-09-12): it used to
    // reject the whole webhook, which is how real orders were lost. See
    // `resolvePhone`.
    const phone = this.resolvePhone(
      this.optionalString(billing, "phone") ?? this.optionalString(shipping, "phone"),
      externalId,
    );
    const email = this.optionalString(billing, "email");
    const billingName = this.fullName(billing);
    const address = this.parseAddress(order, billing, shipping);
    return {
      name,
      phone: phone.value,
      ...(billingName !== undefined ? { billingName } : {}),
      ...(phone.placeholder ? { phonePlaceholder: true } : {}),
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
  ): { line: string; city?: string; state?: string; recipientName?: string } | undefined {
    const shippingLine = this.addressLine(shipping);
    const billingLine = this.addressLine(billing);
    const line = shippingLine ?? billingLine;
    if (line === undefined) return undefined;
    const usingShipping = shippingLine !== undefined;
    const meta = this.metaMap(order);
    const recipientName = this.fullName(shipping) ?? this.fullName(billing);
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
      ...(recipientName !== undefined ? { recipientName } : {}),
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
  /**
   * Best-effort conversion of an Egyptian number to the E.164 form the
   * customers module demands. That module deliberately rejects a bare
   * national number (`customers/domain/phone.ts`) because interpreting one
   * needs a country and a company has no country setting yet — which makes
   * this adapter, the only WooCommerce-and-therefore-Egypt-aware link in the
   * chain, responsible for supplying the country code.
   *
   * The original version tested the raw string against `/^0\d{10}$/` and
   * passed everything else through untouched, so a real order was lost
   * (#31638, 2026-09-11) over a number typed `201001234567` — correct, just
   * missing its `+`. Checkout fields are free text: shoppers type spaces,
   * dashes, Arabic-Indic digits, a leading `00`, or drop the trunk `0`. Each
   * of those is recognisable with certainty, so each is handled.
   *
   * Anything still unrecognised is returned unchanged, never guessed at: a
   * non-Egyptian number must reach the customers module intact and be judged
   * there. `resolvePhone` is what keeps an unrecognised one from costing the
   * order.
   */
  private normalizeEgyptianPhone(phone: string): string {
    const cleaned = this.toAsciiDigits(phone).replace(/[\s\-().]/g, "");
    if (cleaned.startsWith("+")) return cleaned;
    // `00` is the international access code, so `0020…` is already an
    // international number — not a national one that happens to start `0`.
    if (cleaned.startsWith("00")) return `+${cleaned.slice(2)}`;
    // `20` + a 10-digit subscriber number: international, missing only its
    // `+`. The length test keeps this from swallowing a national number that
    // merely starts with `20` — those are 11 digits and begin with `0`.
    if (/^20\d{10}$/.test(cleaned)) return `+${cleaned}`;
    // The two national spellings: with the trunk `0`, and without it.
    if (/^0\d{10}$/.test(cleaned)) return `+20${cleaned.slice(1)}`;
    if (/^1\d{9}$/.test(cleaned)) return `+20${cleaned}`;
    return phone;
  }

  /**
   * Arabic-Indic (`٠١٢…`) and Extended Arabic-Indic (`۰۱۲…`) digits mapped to
   * ASCII. An Arabic storefront gets these from any shopper whose keyboard
   * produces them, and every pattern above expects ASCII.
   */
  private toAsciiDigits(value: string): string {
    return value.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (d) =>
      String((d.codePointAt(0) ?? 0) & 0xf),
    );
  }

  /**
   * The order's phone, or a placeholder that lets the order through anyway.
   *
   * A missing or unparseable phone used to throw, which rejected the whole
   * webhook and lost the order — the customers module treats the phone as the
   * customer's identity key and will not accept a non-E.164 value. Policy
   * call (2026-09-12): never lose an order over a phone. The same reasoning
   * as the vendor-warehouse fallback — a wrong-but-visible record beats a
   * real customer order that silently never arrived.
   *
   * The cost is deliberate and worth stating: the placeholder becomes that
   * customer's identity, so two bad-phone orders from the same real person
   * become two customer records. Staff fix it from the storefront event,
   * which still holds the number exactly as it was typed.
   */
  private resolvePhone(
    raw: string | undefined,
    externalId: string,
  ): { value: string; placeholder: boolean } {
    if (raw !== undefined && raw.trim().length > 0) {
      const normalized = this.normalizeEgyptianPhone(raw.trim());
      if (E164.test(normalized)) return { value: normalized, placeholder: false };
    }
    return { value: this.placeholderPhone(externalId), placeholder: true };
  }

  /**
   * A unique, deliberately-not-real stand-in for an unusable phone. `+999` is
   * an ITU-reserved country code, so this can never collide with a genuine
   * number and reads as obviously synthetic in the customers list.
   *
   * Derived from the order id rather than random so a retried delivery of the
   * same order resolves to the same customer instead of a fresh duplicate.
   */
  private placeholderPhone(externalId: string): string {
    const digits = externalId.replace(/\D/g, "").slice(-10).padStart(10, "0");
    return `+999${digits}`;
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

  /**
   * The product's own sku, or `WOO-<id>` synthesized from the WooCommerce
   * product id. WooCommerce does not require a sku, and requiring one here is
   * what disabled the product webhook on 29 Sept — see the class docs.
   */
  private resolveProductSku(
    product: JsonRecord,
    externalId: string,
  ): { value: string; synthesized: boolean } {
    const own = this.optionalString(product, "sku");
    return own !== undefined
      ? { value: own, synthesized: false }
      : { value: `WOO-${externalId}`, synthesized: true };
  }

  private parsePrice(product: JsonRecord, externalId: string): number {
    const price = product["price"];
    const regular = product["regular_price"];
    const source =
      typeof price === "string" && price.length > 0
        ? price
        : typeof regular === "string" && regular.length > 0
          ? regular
          : undefined;
    // A product with no price at all (a draft, or a "call us" listing) is
    // still worth having in the catalogue; zero is visibly wrong and
    // correctable, where a failed event is neither.
    if (source === undefined) return 0;
    return this.toMinorUnits(source, `WooCommerce product ${externalId} price`);
  }

  /**
   * `undefined` — never a thrown error — when WooCommerce reports
   * `manage_stock: false`: there is no absolute on-hand figure to give, but
   * that alone doesn't make the rest of the product unsyncable (name,
   * price, image, ...). `StorefrontIngestionService` skips the stock-sync
   * step entirely in that case rather than guessing (D5).
   */
  private parseStockQuantity(product: JsonRecord): number | undefined {
    if (product["manage_stock"] === false) {
      return undefined;
    }
    const quantity = product["stock_quantity"];
    // Managed stock with no usable figure (null, negative from a backorder,
    // fractional) is treated like unmanaged stock: the catalogue fields sync,
    // the stock step is skipped. Failing the product here is the same mistake
    // as failing it for a missing sku — see the class docs.
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 0) {
      return undefined;
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
