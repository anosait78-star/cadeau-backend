import type { RequestPrincipal } from "../auth/authenticated-request";

/** The subset of a product row callers outside `products` need. */
export interface CatalogProduct {
  readonly id: string;
}

/** The subset of a variant row callers outside `products` need. */
export interface CatalogVariant {
  readonly id: string;
  readonly productId: string;
}

export interface CatalogProductInput {
  readonly name: string;
  readonly description?: string | null;
  readonly imageUrl?: string | null;
}

export interface CatalogVariantInput {
  readonly name: string;
  readonly sku?: string | null;
  readonly barcode?: string | null;
  readonly sellingPriceMinor?: number;
  readonly active?: boolean;
}

/**
 * Shared cross-feature contract over the products catalog. The products
 * feature implements it (`ProductsService` structurally satisfies this
 * shape); storefront-integration consumes it instead of importing `products`
 * directly (architecture rule `no-cross-feature-imports`).
 */
export interface ProductsCatalogPort {
  findVariantBySku(principal: RequestPrincipal, sku: string): Promise<CatalogVariant | null>;
  create(principal: RequestPrincipal, data: CatalogProductInput): Promise<CatalogProduct>;
  update(
    principal: RequestPrincipal,
    id: string,
    data: CatalogProductInput,
  ): Promise<CatalogProduct>;
  createVariant(
    principal: RequestPrincipal,
    productId: string,
    data: CatalogVariantInput,
  ): Promise<CatalogVariant>;
  updateVariant(
    principal: RequestPrincipal,
    productId: string,
    variantId: string,
    data: CatalogVariantInput,
  ): Promise<CatalogVariant>;
}

/** DI token for {@link ProductsCatalogPort}. */
export const PRODUCTS_CATALOG = Symbol("PRODUCTS_CATALOG");
