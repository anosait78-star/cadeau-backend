import { describe, expect, it } from "vitest";
import {
  computeAverage,
  requiresGiftFields,
  requiresLowReason,
  validateReviewInput,
} from "./review-rules";

const baseInput = {
  productType: "clothes",
  qualityRating: 5,
  packagingRating: 5,
  shippingRating: 5,
} as const;

describe("requiresLowReason", () => {
  it("is true for 1 and 2, false for 3-5", () => {
    expect(requiresLowReason(1)).toBe(true);
    expect(requiresLowReason(2)).toBe(true);
    expect(requiresLowReason(3)).toBe(false);
    expect(requiresLowReason(5)).toBe(false);
  });
});

describe("requiresGiftFields", () => {
  it("is true only for gifts", () => {
    expect(requiresGiftFields("gifts")).toBe(true);
    expect(requiresGiftFields("clothes")).toBe(false);
    expect(requiresGiftFields("electronics")).toBe(false);
  });
});

describe("computeAverage", () => {
  it("means the three ratings, rounded to one decimal", () => {
    expect(computeAverage(5, 5, 5)).toBe(5);
    expect(computeAverage(1, 2, 3)).toBe(2);
    expect(computeAverage(5, 4, 4)).toBe(4.3);
    expect(computeAverage(1, 1, 2)).toBe(1.3);
  });
});

describe("validateReviewInput — product type", () => {
  it("rejects an unknown productType", () => {
    const errors = validateReviewInput({ ...baseInput, productType: "furniture" });
    expect(errors).toContainEqual(expect.objectContaining({ field: "productType" }));
  });

  it("accepts every known productType with no gift fields", () => {
    for (const productType of ["clothes", "electronics"]) {
      expect(validateReviewInput({ ...baseInput, productType })).toEqual([]);
    }
  });
});

describe("validateReviewInput — gift fields", () => {
  it("requires all three gift fields when productType is gifts", () => {
    const errors = validateReviewInput({ ...baseInput, productType: "gifts" });
    expect(errors).toContainEqual(expect.objectContaining({ field: "giftRecipientName" }));
    expect(errors).toContainEqual(expect.objectContaining({ field: "giftRecipientRelation" }));
    expect(errors).toContainEqual(expect.objectContaining({ field: "giftOccasion" }));
  });

  it("passes when productType is gifts and all three are present", () => {
    const errors = validateReviewInput({
      ...baseInput,
      productType: "gifts",
      giftRecipientName: "Sara",
      giftRecipientRelation: "Sister",
      giftOccasion: "Birthday",
    });
    expect(errors).toEqual([]);
  });

  it("rejects a gift field present when productType is not gifts", () => {
    const errors = validateReviewInput({
      ...baseInput,
      productType: "clothes",
      giftRecipientName: "Sara",
    });
    expect(errors).toContainEqual(expect.objectContaining({ field: "giftRecipientName" }));
  });
});

describe("validateReviewInput — low reasons", () => {
  it("requires a reason when a rating is 1 or 2", () => {
    const errors = validateReviewInput({ ...baseInput, qualityRating: 2 });
    expect(errors).toContainEqual(expect.objectContaining({ field: "qualityLowReason" }));
  });

  it("passes when a low rating carries its reason", () => {
    const errors = validateReviewInput({
      ...baseInput,
      qualityRating: 1,
      qualityLowReason: "Fabric felt cheap.",
    });
    expect(errors).toEqual([]);
  });

  it("rejects a reason present for a rating above 2", () => {
    const errors = validateReviewInput({
      ...baseInput,
      packagingRating: 4,
      packagingLowReason: "Should not be here.",
    });
    expect(errors).toContainEqual(expect.objectContaining({ field: "packagingLowReason" }));
  });

  it("checks quality/packaging/shipping independently", () => {
    const errors = validateReviewInput({
      ...baseInput,
      qualityRating: 1,
      qualityLowReason: "Bad fit.",
      shippingRating: 2,
      // shippingLowReason intentionally omitted — should be the only error.
    });
    expect(errors).toEqual([expect.objectContaining({ field: "shippingLowReason" })]);
  });
});
