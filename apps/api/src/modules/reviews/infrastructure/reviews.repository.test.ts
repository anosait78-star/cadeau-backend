import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@cadeau/database";
import { ReviewAlreadyExistsError } from "../domain/reviews.errors";
import { ReviewsRepository } from "./reviews.repository";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const ORDER = "33333333-3333-3333-3333-333333333333";
const CUSTOMER = "44444444-4444-4444-4444-444444444444";
const CREATED = new Date("2026-01-02T03:04:05.000Z");

const actor = { companyId: COMPANY, actorId: ACTOR };

function reviewRow(extra: Record<string, unknown> = {}) {
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
    createdAt: CREATED,
    ...extra,
  };
}

function delegate() {
  return {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
  };
}

function makeRepo() {
  const models = { orderReview: delegate(), order: delegate() };
  const queryRaw = vi.fn().mockResolvedValue([]);
  const txHost = { $queryRaw: queryRaw, ...models };
  const prisma = {
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(txHost)),
  };
  const repo = new ReviewsRepository(prisma as unknown as PrismaClient);
  return { repo, models, queryRaw };
}

/** A Prisma unique-violation on the given index. */
function uniqueViolation(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6",
    meta: { target },
  });
}

const createInput = {
  orderId: ORDER,
  customerId: CUSTOMER,
  productType: "clothes" as const,
  giftRecipientName: null,
  giftRecipientRelation: null,
  giftOccasion: null,
  qualityRating: 5,
  qualityLowReason: null,
  packagingRating: 4,
  packagingLowReason: null,
  shippingRating: 3,
  shippingLowReason: null,
};

describe("ReviewsRepository — reads", () => {
  it("binds the RLS context and returns null when no review exists", async () => {
    const { repo, queryRaw } = makeRepo();
    await expect(repo.findByOrderId(COMPANY, ORDER)).resolves.toBeNull();
    expect(queryRaw).toHaveBeenCalled(); // setTenantContext ran
  });

  it("maps a row to a view with the computed average", async () => {
    const { repo, models } = makeRepo();
    models.orderReview.findFirst.mockResolvedValueOnce(reviewRow());
    const view = await repo.findByOrderId(COMPANY, ORDER);
    expect(view).toMatchObject({
      id: "r1",
      orderId: ORDER,
      qualityRating: 5,
      packagingRating: 4,
      shippingRating: 3,
      averageRating: 4, // (5+4+3)/3 = 4
      createdAt: CREATED.toISOString(),
    });
  });

  it("reads the order directly from the shared orders table", async () => {
    const { repo, models } = makeRepo();
    models.order.findFirst.mockResolvedValueOnce({
      id: ORDER,
      status: "delivered",
      customerId: CUSTOMER,
    });
    const order = await repo.findOrderForReview(COMPANY, ORDER);
    expect(order).toEqual({ id: ORDER, status: "delivered", customerId: CUSTOMER });
    expect(models.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ORDER, companyId: COMPANY } }),
    );
  });

  it("returns null for an order absent in this tenant", async () => {
    const { repo } = makeRepo();
    await expect(repo.findOrderForReview(COMPANY, "nope")).resolves.toBeNull();
  });
});

describe("ReviewsRepository — create", () => {
  it("creates a review and returns it with the computed average", async () => {
    const { repo, models } = makeRepo();
    models.orderReview.create.mockResolvedValueOnce(reviewRow());

    const view = await repo.create(actor, createInput);

    expect(view).toMatchObject({ id: "r1", orderId: ORDER, averageRating: 4 });
    const data = models.orderReview.create.mock.calls[0]?.[0]?.data;
    expect(data).toMatchObject({
      companyId: COMPANY,
      createdBy: ACTOR,
      orderId: ORDER,
      customerId: CUSTOMER,
    });
    expect(data).not.toHaveProperty("updatedBy");
  });

  it("maps a unique-violation on order_id to ReviewAlreadyExistsError", async () => {
    const { repo, models } = makeRepo();
    models.orderReview.create.mockRejectedValueOnce(uniqueViolation("order_reviews_order_key"));

    await expect(repo.create(actor, createInput)).rejects.toThrow(ReviewAlreadyExistsError);
  });

  it("lets an unrelated error propagate unmapped", async () => {
    const { repo, models } = makeRepo();
    models.orderReview.create.mockRejectedValueOnce(new Error("db exploded"));

    await expect(repo.create(actor, createInput)).rejects.toThrow("db exploded");
  });
});
