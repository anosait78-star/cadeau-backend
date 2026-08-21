/**
 * Order review domain views (Order Reviews feature). A one-time, immutable
 * customer review of a delivered/completed order: what kind of product was
 * bought (with gift-specific detail when it's a gift), and three 1-5 star
 * ratings — quality, packaging, shipping — each with its own required reason
 * when it's a low rating (1-2).
 */

/** What was bought, in this order's review. */
export const PRODUCT_TYPES = ["clothes", "electronics", "gifts"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export function isValidProductType(value: string): value is ProductType {
  return (PRODUCT_TYPES as readonly string[]).includes(value);
}

/** A single order's review, as returned by the API. */
export interface OrderReviewView {
  readonly id: string;
  readonly orderId: string;
  readonly customerId: string;
  readonly productType: ProductType;
  /** Set only when productType is "gifts"; null otherwise. */
  readonly giftRecipientName: string | null;
  readonly giftRecipientRelation: string | null;
  readonly giftOccasion: string | null;
  readonly qualityRating: number;
  /** Set only when qualityRating is 1-2; null otherwise. */
  readonly qualityLowReason: string | null;
  readonly packagingRating: number;
  readonly packagingLowReason: string | null;
  readonly shippingRating: number;
  readonly shippingLowReason: string | null;
  /** Mean of the three ratings, rounded to one decimal — always derived, never stored. */
  readonly averageRating: number;
  readonly createdAt: string;
}
