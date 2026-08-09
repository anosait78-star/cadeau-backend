import { describe, expect, it } from "vitest";
import { UnsupportedPlatformError } from "../domain/storefront.errors";
import { GenericJsonAdapter } from "../infrastructure/generic-json.adapter";
import { WooCommerceAdapter } from "../infrastructure/woocommerce.adapter";
import { StorefrontAdapterResolver } from "./storefront-adapter.resolver";

describe("StorefrontAdapterResolver", () => {
  const generic = new GenericJsonAdapter();
  const woocommerce = new WooCommerceAdapter();
  const resolver = new StorefrontAdapterResolver(generic, woocommerce);

  it("resolves the generic platform to GenericJsonAdapter", () => {
    expect(resolver.resolve("generic")).toBe(generic);
  });

  it("resolves the woocommerce platform to WooCommerceAdapter", () => {
    expect(resolver.resolve("woocommerce")).toBe(woocommerce);
  });

  it("throws a clear, typed error for a platform with no registered adapter yet", () => {
    expect(() => resolver.resolve("salla")).toThrow(UnsupportedPlatformError);
    expect(() => resolver.resolve("zid")).toThrow(UnsupportedPlatformError);
    expect(() => resolver.resolve("shopify")).toThrow(UnsupportedPlatformError);
    try {
      resolver.resolve("salla");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedPlatformError);
      expect((error as UnsupportedPlatformError).message).toContain("salla");
    }
  });
});
