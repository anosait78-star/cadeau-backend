import { apiFetch } from "@/lib/api-client";

/** A product in my own warehouse (Vendor Accounts) — read-only. */
export interface VendorProduct {
  readonly id: string;
  readonly name: string;
  readonly imageUrl: string | null;
  /** Lowest sellable price among this product's variants, integer minor units. */
  readonly priceMinor: number;
  readonly availableQuantity: number;
}

/**
 * `GET /v1/vendor/products` — my own warehouse's products. Guarded server-side
 * by session only (not `products.read`/`inventory.read`); a caller with no
 * active vendor membership gets an empty list, not an error.
 */
export function listMyVendorProducts(): Promise<{ data: VendorProduct[] }> {
  return apiFetch<{ data: VendorProduct[] }>("/vendor/products");
}
