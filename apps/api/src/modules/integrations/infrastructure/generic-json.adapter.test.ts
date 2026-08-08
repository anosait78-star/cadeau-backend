import { describe, expect, it } from "vitest";
import { AppException } from "../../../shared/errors/app-exception";
import { GenericJsonAdapter } from "./generic-json.adapter";

describe("GenericJsonAdapter", () => {
  const adapter = new GenericJsonAdapter();

  it("parseOrder is an identity mapping for a well-formed payload", () => {
    const raw = {
      externalId: "store-order-1",
      placedAt: "2026-08-08T10:00:00Z",
      customer: { name: "Ahmed", phone: "01001234567" },
      items: [{ sku: "SKU-1", quantity: 2, unitPriceMinor: 15000 }],
    };
    expect(adapter.parseOrder(raw)).toEqual(raw);
  });

  it("parseOrder rejects a non-object payload", () => {
    expect(() => adapter.parseOrder("nope")).toThrow(AppException);
    expect(() => adapter.parseOrder(null)).toThrow(AppException);
  });

  it("parseProduct is an identity mapping for a well-formed payload", () => {
    const raw = {
      externalId: "store-product-1",
      name: "Mug",
      sku: "SKU-1",
      priceMinor: 15000,
      stockQuantity: 10,
    };
    expect(adapter.parseProduct(raw)).toEqual(raw);
  });

  it("parseProduct rejects a non-object payload", () => {
    expect(() => adapter.parseProduct(42)).toThrow(AppException);
    expect(() => adapter.parseProduct(undefined)).toThrow(AppException);
  });
});
