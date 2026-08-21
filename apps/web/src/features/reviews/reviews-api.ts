import { apiFetch, ApiError } from "@/lib/api-client";

/**
 * Client for `/v1/reviews` — a one-time, immutable customer review of a
 * delivered/completed order. Create-only: no update route exists.
 */

/** What was bought, in this order's review. */
export const PRODUCT_TYPES = ["clothes", "electronics", "gifts"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/** A single order's review. */
export interface OrderReview {
  readonly id: string;
  readonly orderId: string;
  readonly customerId: string;
  readonly productType: ProductType;
  readonly giftRecipientName: string | null;
  readonly giftRecipientRelation: string | null;
  readonly giftOccasion: string | null;
  readonly qualityRating: number;
  readonly qualityLowReason: string | null;
  readonly packagingRating: number;
  readonly packagingLowReason: string | null;
  readonly shippingRating: number;
  readonly shippingLowReason: string | null;
  /** Mean of the three ratings, rounded to one decimal. */
  readonly averageRating: number;
  readonly createdAt: string;
}

/** `POST /v1/reviews/orders/{orderId}` payload. */
export interface CreateReviewInput {
  readonly productType: ProductType;
  readonly giftRecipientName?: string;
  readonly giftRecipientRelation?: string;
  readonly giftOccasion?: string;
  readonly qualityRating: number;
  readonly qualityLowReason?: string;
  readonly packagingRating: number;
  readonly packagingLowReason?: string;
  readonly shippingRating: number;
  readonly shippingLowReason?: string;
}

/**
 * `GET /v1/reviews/orders/{orderId}` — the order's review, or `null` when it
 * has none yet (404) — a normal state, not an error.
 */
export async function getOrderReview(orderId: string): Promise<OrderReview | null> {
  try {
    return await apiFetch<OrderReview>(`/reviews/orders/${orderId}`);
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

/** `POST /v1/reviews/orders/{orderId}` — add the order's (one-time) review. */
export function createOrderReview(orderId: string, input: CreateReviewInput): Promise<OrderReview> {
  return apiFetch<OrderReview>(`/reviews/orders/${orderId}`, { method: "POST", body: input });
}
