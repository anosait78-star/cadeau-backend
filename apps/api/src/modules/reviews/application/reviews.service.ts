import { Inject, Injectable } from "@nestjs/common";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppErrors } from "../../../shared/errors/app-exception";
import { withErrorMapping } from "../../../shared/errors/with-error-mapping";
import { validateReviewInput } from "../domain/review-rules";
import type { OrderReviewView, ProductType } from "../domain/review.entity";
import { REVIEWS_AUDIT, type ReviewsAuditPort } from "../domain/reviews-audit.port";
import {
  REVIEWS_REPOSITORY,
  type ReviewsRepositoryPort,
  type WriteActor,
} from "../domain/reviews-repository.port";
import { ReviewAlreadyExistsError } from "../domain/reviews.errors";

/** Order statuses a review may be attached to. */
const REVIEWABLE_ORDER_STATUSES = new Set(["delivered", "completed"]);

/** What the caller submits when adding a review. */
export interface CreateReviewCommand {
  readonly productType: string;
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
 * Orchestrates the reviews module (Order Reviews feature). A review is
 * create-only: exactly one per order, no update path, and entirely optional
 * — an order sitting in delivered/completed forever with no review is a
 * normal state, not something the caller is nudged about. Access is gated by
 * the controller's `@RequireCapability` (orders.read/orders.manage); this
 * service assumes an authorized caller.
 */
@Injectable()
export class ReviewsService {
  constructor(
    @Inject(REVIEWS_REPOSITORY) private readonly repo: ReviewsRepositoryPort,
    @Inject(REVIEWS_AUDIT) private readonly audit: ReviewsAuditPort,
  ) {}

  async getByOrder(principal: RequestPrincipal, orderId: string): Promise<OrderReviewView | null> {
    const companyId = this.requireTenant(principal);
    return this.repo.findByOrderId(companyId, orderId);
  }

  async create(
    principal: RequestPrincipal,
    orderId: string,
    command: CreateReviewCommand,
  ): Promise<OrderReviewView> {
    const companyId = this.requireTenant(principal);
    const actor: WriteActor = { companyId, actorId: principal.userId };

    const order = await this.repo.findOrderForReview(companyId, orderId);
    if (order === null) throw AppErrors.notFound("Order not found.");
    if (!REVIEWABLE_ORDER_STATUSES.has(order.status)) {
      throw AppErrors.unprocessable(`Order status '${order.status}' cannot be reviewed yet.`, [
        { field: "status", messages: [`Order status '${order.status}' cannot be reviewed yet.`] },
      ]);
    }

    const existing = await this.repo.findByOrderId(companyId, orderId);
    if (existing !== null) {
      throw AppErrors.conflict("This order has already been reviewed.");
    }

    const fieldErrors = validateReviewInput(command);
    if (fieldErrors.length > 0) {
      throw AppErrors.validation("Request validation failed", fieldErrors);
    }

    const review = await withErrorMapping(
      () =>
        this.repo.create(actor, {
          orderId,
          customerId: order.customerId,
          productType: command.productType as ProductType,
          giftRecipientName: command.giftRecipientName ?? null,
          giftRecipientRelation: command.giftRecipientRelation ?? null,
          giftOccasion: command.giftOccasion ?? null,
          qualityRating: command.qualityRating,
          qualityLowReason: command.qualityLowReason ?? null,
          packagingRating: command.packagingRating,
          packagingLowReason: command.packagingLowReason ?? null,
          shippingRating: command.shippingRating,
          shippingLowReason: command.shippingLowReason ?? null,
        }),
      (error) => this.mapError(error),
    );

    await this.audit.record({
      companyId,
      actorId: principal.userId,
      action: "review.created",
      entityType: "order_review",
      entityId: review.id,
      changes: { orderId, productType: review.productType },
    });

    return review;
  }

  private requireTenant(principal: RequestPrincipal): string {
    if (principal.companyId === null) {
      throw AppErrors.forbidden("Select an active company first.");
    }
    return principal.companyId;
  }

  private mapError(error: unknown): unknown {
    if (error instanceof ReviewAlreadyExistsError) {
      return AppErrors.conflict(error.message);
    }
    return error;
  }
}
