import { Injectable } from "@nestjs/common";
import { AppErrors } from "../../../shared/errors/app-exception";
import type {
  NormalizedOrder,
  NormalizedProduct,
  StorefrontAdapterPort,
} from "../domain/storefront-adapter.port";

type JsonRecord = Record<string, unknown>;

/**
 * The identity-mapping adapter for the generic contract (D8): a well-formed
 * payload is returned byte-for-byte unchanged (no re-construction), so this
 * class stays a pure pass-through for the common case.
 *
 * Its own shape checks below mirror what `IngestOrderDto`/`IngestProductDto`
 * (`class-validator`) used to enforce at the HTTP layer. That enforcement
 * moved here once the ingestion controller's `@Body()` was relaxed to
 * `unknown` (needed so a differently-shaped platform payload — e.g.
 * WooCommerce's native order/product JSON — isn't rejected by the global
 * `ValidationPipe` before it ever reaches a per-platform adapter): the
 * generic platform must keep exactly the validation strength it had before,
 * just enforced here instead of by the removed DTO parameter type.
 */
@Injectable()
export class GenericJsonAdapter implements StorefrontAdapterPort {
  parseOrder(raw: unknown): NormalizedOrder {
    const order = this.asRecord(raw, "order");
    this.requireNonEmptyString(order, "externalId", "order");
    this.requireNonEmptyString(order, "placedAt", "order");
    const customer = this.asRecord(order["customer"], "order.customer");
    this.requireNonEmptyString(customer, "name", "order.customer");
    this.requireNonEmptyString(customer, "phone", "order.customer");
    const items = order["items"];
    if (!Array.isArray(items) || items.length === 0) {
      throw AppErrors.badRequest("order.items must be a non-empty array.");
    }
    items.forEach((item, index) => {
      const line = this.asRecord(item, `order.items[${index}]`);
      this.requireNonEmptyString(line, "sku", `order.items[${index}]`);
      this.requirePositiveInt(line, "quantity", `order.items[${index}]`);
      this.requireNonNegativeInt(line, "unitPriceMinor", `order.items[${index}]`);
    });
    return raw as NormalizedOrder;
  }

  parseProduct(raw: unknown): NormalizedProduct {
    const product = this.asRecord(raw, "product");
    this.requireNonEmptyString(product, "externalId", "product");
    this.requireNonEmptyString(product, "name", "product");
    this.requireNonEmptyString(product, "sku", "product");
    this.requireNonNegativeInt(product, "priceMinor", "product");
    this.requireNonNegativeInt(product, "stockQuantity", "product");
    return raw as NormalizedProduct;
  }

  private asRecord(raw: unknown, context: string): JsonRecord {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw AppErrors.badRequest(`Invalid ${context} payload.`);
    }
    return raw as JsonRecord;
  }

  private requireNonEmptyString(record: JsonRecord, key: string, context: string): void {
    const value = record[key];
    if (typeof value !== "string" || value.length === 0) {
      throw AppErrors.badRequest(`${context}.${key} is required.`);
    }
  }

  private requirePositiveInt(record: JsonRecord, key: string, context: string): void {
    const value = record[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      throw AppErrors.badRequest(`${context}.${key} must be a positive integer.`);
    }
  }

  private requireNonNegativeInt(record: JsonRecord, key: string, context: string): void {
    const value = record[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw AppErrors.badRequest(`${context}.${key} must be a non-negative integer.`);
    }
  }
}
