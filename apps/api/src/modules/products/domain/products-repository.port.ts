import type { KeysetPage } from "@cadeau/database";
import type { ParsedProductListQuery } from "./list-query";
import type { ProductVariantView, ProductView, ProductWithVariants } from "./product.entity";

/** The tenant + acting member for a write. */
export interface WriteActor {
  readonly companyId: string;
  readonly actorId: string;
}

/** Fields accepted when creating a product (tenant refs validated by the repo). */
export interface CreateProductInput {
  readonly name: string;
  readonly description?: string | null;
  readonly categoryId?: string | null;
  readonly unitId?: string | null;
  /** Oversell policy (EPIC-9); defaults to `false`. */
  readonly allowOversell?: boolean;
}

/** Partial update for a product; omitted keys are left unchanged. */
export interface UpdateProductInput {
  readonly name?: string;
  readonly description?: string | null;
  readonly categoryId?: string | null;
  readonly unitId?: string | null;
  readonly allowOversell?: boolean;
}

/** Fields accepted when creating a variant. `averageCost` is never client-set. */
export interface CreateVariantInput {
  readonly name: string;
  readonly sku?: string | null;
  readonly barcode?: string | null;
  /** Integer minor units. `averageCost` stays purchase-cost-only and is separate. */
  readonly sellingPriceMinor?: number;
}

/** Partial update for a variant. */
export interface UpdateVariantInput {
  readonly name?: string;
  readonly sku?: string | null;
  readonly barcode?: string | null;
  readonly active?: boolean;
  /** Integer minor units. `averageCost` stays purchase-cost-only and is separate. */
  readonly sellingPriceMinor?: number;
}

/**
 * Port for reading/writing products and their variants (EPIC-8). The Prisma
 * adapter binds the tenant under RLS for every unit of work (the app-layer half
 * of the two-layer isolation model). Uniqueness violations surface as
 * {@link DuplicateProductError}; a bad tenant reference as
 * {@link ReferenceNotFoundError}; a bad cursor as {@link InvalidListCursorError}.
 * Not-found reads/writes return `null`.
 */
export interface ProductsRepositoryPort {
  list(companyId: string, query: ParsedProductListQuery): Promise<KeysetPage<ProductView>>;

  /** A product with its variants, or `null` if absent in this tenant. */
  findById(companyId: string, id: string): Promise<ProductWithVariants | null>;

  create(actor: WriteActor, data: CreateProductInput): Promise<ProductView>;

  update(actor: WriteActor, id: string, data: UpdateProductInput): Promise<ProductView | null>;

  /** Archive a product (`is_active = false`). Returns the row, or `null` if absent. */
  archive(actor: WriteActor, id: string): Promise<ProductView | null>;

  /** The variants of a product, or `null` if the product is absent. */
  listVariants(companyId: string, productId: string): Promise<readonly ProductVariantView[] | null>;

  createVariant(
    actor: WriteActor,
    productId: string,
    data: CreateVariantInput,
  ): Promise<ProductVariantView | null>;

  updateVariant(
    actor: WriteActor,
    productId: string,
    variantId: string,
    data: UpdateVariantInput,
  ): Promise<ProductVariantView | null>;

  /**
   * Find a variant by its exact `sku` within a tenant (storefront-integration
   * ingestion §D8: the ingested `sku` must match an existing variant). `null`
   * when no active variant carries that SKU in this company.
   */
  findVariantBySku(companyId: string, sku: string): Promise<ProductVariantView | null>;
}

/** DI token for {@link ProductsRepositoryPort}. */
export const PRODUCTS_REPOSITORY = Symbol("PRODUCTS_REPOSITORY");
