import { apiFetch } from "@/lib/api-client";

/** A catalog product (list/summary form). */
export interface Product {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly categoryId: string | null;
  readonly unitId: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A product variant. `averageCost` is integer minor units (read-only). */
export interface ProductVariant {
  readonly id: string;
  readonly productId: string;
  readonly name: string;
  readonly sku: string | null;
  readonly barcode: string | null;
  readonly averageCost: number;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A product with its variants (the detail view). */
export interface ProductDetail extends Product {
  readonly variants: ProductVariant[];
}

/** A keyset page of products (api-conventions §5). */
export interface ProductPage {
  readonly data: Product[];
  readonly page: {
    readonly limit: number;
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

/** Query options for the products list. */
export interface ListOptions {
  readonly cursor?: string;
  /** `true` = active only, `false` = archived only, `"all"` = both. */
  readonly active?: boolean | "all";
  readonly q?: string;
  readonly categoryId?: string;
}

function buildQuery(options: ListOptions): string {
  const params = new URLSearchParams();
  if (options.cursor !== undefined) params.set("cursor", options.cursor);
  if (options.active !== undefined) params.set("active", String(options.active));
  if (options.q !== undefined && options.q.length > 0) params.set("q", options.q);
  if (options.categoryId !== undefined) params.set("categoryId", options.categoryId);
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : "";
}

/** Create/update product body. Send `null` to clear an optional field. */
export interface ProductInput {
  readonly name?: string;
  readonly description?: string | null;
  readonly categoryId?: string | null;
  readonly unitId?: string | null;
}

/** Create/update variant body. */
export interface VariantInput {
  readonly name?: string;
  readonly sku?: string | null;
  readonly barcode?: string | null;
  readonly active?: boolean;
}

/** `GET /v1/products` — keyset-paginated products. */
export function listProducts(options: ListOptions = {}): Promise<ProductPage> {
  return apiFetch<ProductPage>(`/products${buildQuery(options)}`);
}

/** `GET /v1/products/{id}` — a product with its variants. */
export function getProduct(id: string): Promise<ProductDetail> {
  return apiFetch<ProductDetail>(`/products/${id}`);
}

/** `POST /v1/products` — create a product. */
export function createProduct(body: ProductInput): Promise<Product> {
  return apiFetch<Product>("/products", { method: "POST", body });
}

/** `PATCH /v1/products/{id}` — update a product. */
export function updateProduct(id: string, body: ProductInput): Promise<Product> {
  return apiFetch<Product>(`/products/${id}`, { method: "PATCH", body });
}

/** `DELETE /v1/products/{id}` — archive a product (soft-delete). */
export function archiveProduct(id: string): Promise<void> {
  return apiFetch<void>(`/products/${id}`, { method: "DELETE" });
}

/** `GET /v1/products/{id}/variants` — a product's variants. */
export function listVariants(productId: string): Promise<{ data: ProductVariant[] }> {
  return apiFetch<{ data: ProductVariant[] }>(`/products/${productId}/variants`);
}

/** `POST /v1/products/{id}/variants` — add a variant. */
export function createVariant(productId: string, body: VariantInput): Promise<ProductVariant> {
  return apiFetch<ProductVariant>(`/products/${productId}/variants`, { method: "POST", body });
}

/** `PATCH /v1/products/{id}/variants/{variantId}` — update a variant. */
export function updateVariant(
  productId: string,
  variantId: string,
  body: VariantInput,
): Promise<ProductVariant> {
  return apiFetch<ProductVariant>(`/products/${productId}/variants/${variantId}`, {
    method: "PATCH",
    body,
  });
}
