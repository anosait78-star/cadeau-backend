import { describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { OrderReviewView } from "../domain/review.entity";
import type { ReviewsService } from "../application/reviews.service";
import { CreateReviewDto } from "./dto/reviews.dto";
import { ReviewsController } from "./reviews.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

const ORDER = "33333333-3333-3333-3333-333333333333";

function reviewView(extra: Partial<OrderReviewView> = {}): OrderReviewView {
  return {
    id: "r1",
    orderId: ORDER,
    customerId: "44444444-4444-4444-4444-444444444444",
    productType: "clothes",
    giftRecipientName: null,
    giftRecipientRelation: null,
    giftOccasion: null,
    qualityRating: 5,
    qualityLowReason: null,
    packagingRating: 4,
    packagingLowReason: null,
    shippingRating: 3,
    shippingLowReason: null,
    averageRating: 4,
    createdAt: "2026-01-02T03:04:05.000Z",
    ...extra,
  };
}

function makeController() {
  const service = {
    getByOrder: vi.fn(),
    create: vi.fn(),
  };
  const controller = new ReviewsController(service as unknown as ReviewsService);
  return { controller, service };
}

function createDto(extra: Partial<CreateReviewDto> = {}): CreateReviewDto {
  const dto = new CreateReviewDto();
  dto.productType = "clothes";
  dto.qualityRating = 5;
  dto.packagingRating = 4;
  dto.shippingRating = 3;
  return Object.assign(dto, extra);
}

describe("ReviewsController — getOne", () => {
  it("returns the review as a DTO", async () => {
    const { controller, service } = makeController();
    service.getByOrder.mockResolvedValue(reviewView());

    const dto = await controller.getOne(principal, ORDER);

    expect(dto.id).toBe("r1");
    expect(dto.averageRating).toBe(4);
    expect(service.getByOrder).toHaveBeenCalledWith(principal, ORDER);
  });

  it("404s when no review exists for the order", async () => {
    const { controller, service } = makeController();
    service.getByOrder.mockResolvedValue(null);

    await expect(controller.getOne(principal, ORDER)).rejects.toThrow();
  });
});

describe("ReviewsController — create", () => {
  it("forwards the body to the service and returns a DTO", async () => {
    const { controller, service } = makeController();
    service.create.mockResolvedValue(reviewView());

    const dto = await controller.create(principal, ORDER, createDto());

    expect(dto.id).toBe("r1");
    expect(service.create).toHaveBeenCalledWith(
      principal,
      ORDER,
      expect.objectContaining({ productType: "clothes", qualityRating: 5 }),
    );
  });

  it("omits undefined optional fields rather than passing them through as undefined", async () => {
    const { controller, service } = makeController();
    service.create.mockResolvedValue(reviewView());

    await controller.create(principal, ORDER, createDto());

    const command = service.create.mock.calls[0]?.[2];
    expect(command).not.toHaveProperty("giftRecipientName");
    expect(command).not.toHaveProperty("qualityLowReason");
  });

  it("forwards gift fields when present", async () => {
    const { controller, service } = makeController();
    service.create.mockResolvedValue(
      reviewView({
        productType: "gifts",
        giftRecipientName: "Sara",
        giftRecipientRelation: "Sister",
        giftOccasion: "Birthday",
      }),
    );

    await controller.create(
      principal,
      ORDER,
      createDto({
        productType: "gifts",
        giftRecipientName: "Sara",
        giftRecipientRelation: "Sister",
        giftOccasion: "Birthday",
      }),
    );

    expect(service.create).toHaveBeenCalledWith(
      principal,
      ORDER,
      expect.objectContaining({
        giftRecipientName: "Sara",
        giftRecipientRelation: "Sister",
        giftOccasion: "Birthday",
      }),
    );
  });
});
