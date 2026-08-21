import type { OrderReviewView, ProductType } from "./review.entity";

/** The company + acting user a write is attributed to. */
export interface WriteActor {
  readonly companyId: string;
  readonly actorId: string | null;
}

/** What's needed from the order row to decide whether/how it can be reviewed. */
export interface OrderForReview {
  readonly id: string;
  readonly status: string;
  readonly customerId: string;
}

/** Everything `create()` needs beyond the actor and the order/customer it resolves. */
export interface CreateReviewInput {
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
}

export interface ReviewsRepositoryPort {
  findByOrderId(companyId: string, orderId: string): Promise<OrderReviewView | null>;
  /** Reads the order directly from the shared `orders` table (no cross-module import). */
  findOrderForReview(companyId: string, orderId: string): Promise<OrderForReview | null>;
  create(actor: WriteActor, input: CreateReviewInput): Promise<OrderReviewView>;
}

/** DI token for {@link ReviewsRepositoryPort}. */
export const REVIEWS_REPOSITORY = Symbol("REVIEWS_REPOSITORY");
