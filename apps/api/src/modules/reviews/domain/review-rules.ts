import type { FieldError } from "../../../shared/errors/validation";
import { isValidProductType, type ProductType } from "./review.entity";

/** A rating of 1-2 is "low" and requires its own reason (mirrors the DB CHECK). */
export function requiresLowReason(rating: number): boolean {
  return rating <= 2;
}

/** Only a "gifts" review carries recipient/relation/occasion (mirrors the DB CHECK). */
export function requiresGiftFields(productType: ProductType): boolean {
  return productType === "gifts";
}

/** Mean of the three ratings, rounded to one decimal. */
export function computeAverage(quality: number, packaging: number, shipping: number): number {
  return Math.round(((quality + packaging + shipping) / 3) * 10) / 10;
}

/** The raw input `validateReviewInput` checks — the DTO shape, pre-normalization. */
export interface ReviewInput {
  readonly productType: string;
  readonly giftRecipientName?: string | null;
  readonly giftRecipientRelation?: string | null;
  readonly giftOccasion?: string | null;
  readonly qualityRating: number;
  readonly qualityLowReason?: string | null;
  readonly packagingRating: number;
  readonly packagingLowReason?: string | null;
  readonly shippingRating: number;
  readonly shippingLowReason?: string | null;
}

/**
 * Validate the cross-field rules the DTO's per-field decorators can't express
 * (gift fields present iff productType is "gifts"; a *LowReason present iff its
 * rating is 1-2). Checked here — not just left to the DB CHECK — so a violation
 * comes back as a clear `422` field error instead of an opaque Postgres message.
 */
export function validateReviewInput(input: ReviewInput): FieldError[] {
  const errors: FieldError[] = [];

  if (!isValidProductType(input.productType)) {
    errors.push({
      field: "productType",
      messages: ["Must be one of clothes, electronics, gifts."],
    });
    return errors; // the gift-fields check below needs a valid productType
  }

  const wantsGiftFields = requiresGiftFields(input.productType);
  for (const [field, value] of [
    ["giftRecipientName", input.giftRecipientName],
    ["giftRecipientRelation", input.giftRecipientRelation],
    ["giftOccasion", input.giftOccasion],
  ] as const) {
    const present = value !== null && value !== undefined && value !== "";
    if (wantsGiftFields && !present) {
      errors.push({ field, messages: ["Required when productType is 'gifts'."] });
    } else if (!wantsGiftFields && present) {
      errors.push({ field, messages: ["Only allowed when productType is 'gifts'."] });
    }
  }

  // Rating range (1-5, integer) is already enforced by the DTO's own
  // @IsInt/@Min/@Max decorators — only the cross-field "reason required iff
  // low" rule needs checking here.
  for (const [reasonField, rating, reason] of [
    ["qualityLowReason", input.qualityRating, input.qualityLowReason],
    ["packagingLowReason", input.packagingRating, input.packagingLowReason],
    ["shippingLowReason", input.shippingRating, input.shippingLowReason],
  ] as const) {
    const present = reason !== null && reason !== undefined && reason !== "";
    if (requiresLowReason(rating) && !present) {
      errors.push({ field: reasonField, messages: ["Required when the rating is 1 or 2."] });
    } else if (!requiresLowReason(rating) && present) {
      errors.push({ field: reasonField, messages: ["Only allowed when the rating is 1 or 2."] });
    }
  }

  return errors;
}
