import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient, setTenantContext } from "@cadeau/database";
import { computeAverage } from "../domain/review-rules";
import type { OrderReviewView, ProductType } from "../domain/review.entity";
import type {
  CreateReviewInput,
  OrderForReview,
  ReviewsRepositoryPort,
  WriteActor,
} from "../domain/reviews-repository.port";
import { ReviewAlreadyExistsError } from "../domain/reviews.errors";
import { REVIEWS_PRISMA_CLIENT } from "./prisma-client.provider";

type Tx = Prisma.TransactionClient;

const REVIEW_SELECT = {
  id: true,
  orderId: true,
  customerId: true,
  productType: true,
  giftRecipientName: true,
  giftRecipientRelation: true,
  giftOccasion: true,
  qualityRating: true,
  qualityLowReason: true,
  packagingRating: true,
  packagingLowReason: true,
  shippingRating: true,
  shippingLowReason: true,
  createdAt: true,
} as const;

type ReviewRow = Prisma.OrderReviewGetPayload<{ select: typeof REVIEW_SELECT }>;

/**
 * Prisma-backed reviews repository (Order Reviews feature). `orders` is a
 * sibling module, never imported here — this repository reads the shared
 * `orders` table directly under its own tenant transaction, the same idiom
 * `ShippingRepository.assertShippable` uses.
 */
@Injectable()
export class ReviewsRepository implements ReviewsRepositoryPort {
  constructor(@Inject(REVIEWS_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findByOrderId(companyId: string, orderId: string): Promise<OrderReviewView | null> {
    const row = await this.tenantTx(companyId, (tx) =>
      tx.orderReview.findFirst({ where: { orderId, companyId }, select: REVIEW_SELECT }),
    );
    return row === null ? null : this.toView(row);
  }

  async findOrderForReview(companyId: string, orderId: string): Promise<OrderForReview | null> {
    return this.tenantTx(companyId, (tx) =>
      tx.order.findFirst({
        where: { id: orderId, companyId },
        select: { id: true, status: true, customerId: true },
      }),
    );
  }

  async create(actor: WriteActor, input: CreateReviewInput): Promise<OrderReviewView> {
    return this.tenantTx(actor.companyId, async (tx) => {
      try {
        // No stampForCreate here: unlike most tables, order_reviews has no
        // updatedBy/updatedAt (create-only, matches the order_activities
        // append-only idiom) — stamping one in would be an unknown Prisma field.
        const row = await tx.orderReview.create({
          data: {
            companyId: actor.companyId,
            createdBy: actor.actorId,
            orderId: input.orderId,
            customerId: input.customerId,
            productType: input.productType,
            giftRecipientName: input.giftRecipientName,
            giftRecipientRelation: input.giftRecipientRelation,
            giftOccasion: input.giftOccasion,
            qualityRating: input.qualityRating,
            qualityLowReason: input.qualityLowReason,
            packagingRating: input.packagingRating,
            packagingLowReason: input.packagingLowReason,
            shippingRating: input.shippingRating,
            shippingLowReason: input.shippingLowReason,
          } satisfies Prisma.OrderReviewUncheckedCreateInput,
          select: REVIEW_SELECT,
        });
        return this.toView(row);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ReviewAlreadyExistsError(input.orderId);
        }
        throw error;
      }
    });
  }

  // ---- internals -------------------------------------------------------------

  private tenantTx<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return fn(tx);
    });
  }

  private toView(row: ReviewRow): OrderReviewView {
    return {
      id: row.id,
      orderId: row.orderId,
      customerId: row.customerId,
      productType: row.productType as ProductType,
      giftRecipientName: row.giftRecipientName,
      giftRecipientRelation: row.giftRecipientRelation,
      giftOccasion: row.giftOccasion,
      qualityRating: row.qualityRating,
      qualityLowReason: row.qualityLowReason,
      packagingRating: row.packagingRating,
      packagingLowReason: row.packagingLowReason,
      shippingRating: row.shippingRating,
      shippingLowReason: row.shippingLowReason,
      averageRating: computeAverage(row.qualityRating, row.packagingRating, row.shippingRating),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
