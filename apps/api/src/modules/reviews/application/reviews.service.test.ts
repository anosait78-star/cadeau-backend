import { describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { OrderReviewView } from "../domain/review.entity";
import type { OrderForReview, ReviewsRepositoryPort } from "../domain/reviews-repository.port";
import { ReviewAlreadyExistsError } from "../domain/reviews.errors";
import { ReviewsService, type CreateReviewCommand } from "./reviews.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const ORDER = "33333333-3333-3333-3333-333333333333";
const CUSTOMER = "44444444-4444-4444-4444-444444444444";

const principal: RequestPrincipal = { userId: USER, sessionId: "s1", companyId: COMPANY };

function orderForReview(extra: Partial<OrderForReview> = {}): OrderForReview {
  return { id: ORDER, status: "delivered", customerId: CUSTOMER, ...extra };
}

function reviewView(extra: Partial<OrderReviewView> = {}): OrderReviewView {
  return {
    id: "r1",
    orderId: ORDER,
    customerId: CUSTOMER,
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

const validCommand: CreateReviewCommand = {
  productType: "clothes",
  qualityRating: 5,
  packagingRating: 4,
  shippingRating: 3,
};

function makeService() {
  const repo: { [K in keyof ReviewsRepositoryPort]: ReturnType<typeof vi.fn> } = {
    findByOrderId: vi.fn().mockResolvedValue(null),
    findOrderForReview: vi.fn().mockResolvedValue(orderForReview()),
    create: vi.fn().mockResolvedValue(reviewView()),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new ReviewsService(repo as unknown as ReviewsRepositoryPort, audit);
  return { service, repo, audit };
}

describe("ReviewsService — tenant enforcement", () => {
  it("rejects a caller with no active company", async () => {
    const { service } = makeService();
    const noCompany: RequestPrincipal = { userId: USER, sessionId: "s1", companyId: null };
    await expect(service.getByOrder(noCompany, ORDER)).rejects.toThrow();
    await expect(service.create(noCompany, ORDER, validCommand)).rejects.toThrow();
  });
});

describe("ReviewsService — create", () => {
  it("creates a review for a delivered order and records an audit row", async () => {
    const { service, repo, audit } = makeService();
    const review = await service.create(principal, ORDER, validCommand);

    expect(review.id).toBe("r1");
    expect(repo.create).toHaveBeenCalledWith(
      { companyId: COMPANY, actorId: USER },
      expect.objectContaining({ orderId: ORDER, customerId: CUSTOMER, productType: "clothes" }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "review.created",
        entityType: "order_review",
        entityId: "r1",
      }),
    );
    // No customer/gift PII in the audit changes payload.
    const changes = audit.record.mock.calls[0]?.[0]?.changes;
    expect(JSON.stringify(changes)).not.toContain(CUSTOMER);
  });

  it("also accepts a completed order", async () => {
    const { service, repo } = makeService();
    repo.findOrderForReview.mockResolvedValueOnce(orderForReview({ status: "completed" }));
    await expect(service.create(principal, ORDER, validCommand)).resolves.toBeDefined();
  });

  it("404s when the order does not exist", async () => {
    const { service, repo } = makeService();
    repo.findOrderForReview.mockResolvedValueOnce(null);
    await expect(service.create(principal, ORDER, validCommand)).rejects.toThrow();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects an order that is not yet delivered/completed", async () => {
    const { service, repo } = makeService();
    repo.findOrderForReview.mockResolvedValueOnce(orderForReview({ status: "processing" }));
    await expect(service.create(principal, ORDER, validCommand)).rejects.toThrow();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("409s when the order already has a review (pre-check)", async () => {
    const { service, repo } = makeService();
    repo.findByOrderId.mockResolvedValueOnce(reviewView());
    await expect(service.create(principal, ORDER, validCommand)).rejects.toThrow();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("maps a repository-level race (ReviewAlreadyExistsError) to a client error too", async () => {
    const { service, repo } = makeService();
    repo.create.mockRejectedValueOnce(new ReviewAlreadyExistsError(ORDER));
    await expect(service.create(principal, ORDER, validCommand)).rejects.toThrow();
  });

  it("422s a cross-field violation before ever touching the repository's create", async () => {
    const { service, repo } = makeService();
    await expect(
      service.create(principal, ORDER, { ...validCommand, qualityRating: 1 }), // missing reason
    ).rejects.toThrow();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("accepts and forwards gift fields for productType 'gifts'", async () => {
    const { service, repo } = makeService();
    await service.create(principal, ORDER, {
      ...validCommand,
      productType: "gifts",
      giftRecipientName: "Sara",
      giftRecipientRelation: "Sister",
      giftOccasion: "Birthday",
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        giftRecipientName: "Sara",
        giftRecipientRelation: "Sister",
        giftOccasion: "Birthday",
      }),
    );
  });
});

describe("ReviewsService — getByOrder", () => {
  it("returns null when no review exists (not an error)", async () => {
    const { service } = makeService();
    await expect(service.getByOrder(principal, ORDER)).resolves.toBeNull();
  });

  it("returns the review when one exists", async () => {
    const { service, repo } = makeService();
    repo.findByOrderId.mockResolvedValueOnce(reviewView());
    await expect(service.getByOrder(principal, ORDER)).resolves.toMatchObject({ id: "r1" });
  });
});
