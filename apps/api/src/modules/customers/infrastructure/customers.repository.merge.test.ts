import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@cadeau/database";
import type { InjectedAppConfig } from "../../../shared/config/config.tokens";
import { InvalidMergeError } from "../domain/customers.errors";
import { CUSTOMER_OWNED_TABLES, CustomersRepository } from "./customers.repository";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const WINNER = "33333333-3333-3333-3333-333333333333";
const LOSER = "44444444-4444-4444-4444-444444444444";

const config = {
  encryption: { key: "00".repeat(32), blindIndexKey: "aa".repeat(32) },
} as unknown as InjectedAppConfig;

const actor = { companyId: COMPANY, actorId: ACTOR };

function makeRepo() {
  const models = {
    customer: {
      findFirst: vi.fn().mockResolvedValue({ id: "x" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    customerAddress: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    orderReview: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    order: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({
        _count: { _all: 2 },
        _sum: { collectedAmount: 5000n },
        _max: { createdAt: new Date("2026-01-02T00:00:00.000Z") },
      }),
    },
  };
  const txHost = { $queryRaw: vi.fn(() => Promise.resolve([])), ...models };
  const prisma = { $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(txHost)) };
  const repo = new CustomersRepository(prisma as unknown as PrismaClient, config);
  return { repo, models };
}

describe("CustomersRepository — merge (EPIC-11, decision D5)", () => {
  it("re-parents every customer-owned table, archives the loser, recomputes KPIs", async () => {
    const { repo, models } = makeRepo();
    const result = await repo.merge(actor, WINNER, LOSER);

    expect(result).toEqual({ survivingCustomerId: WINNER, mergedCustomerId: LOSER });
    // Addresses re-parented (default flag cleared) …
    expect(models.customerAddress.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ customerId: LOSER }),
        data: expect.objectContaining({ customerId: WINNER, isDefault: false }),
      }),
    );
    // … orders re-parented …
    expect(models.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ customerId: LOSER }),
        data: expect.objectContaining({ customerId: WINNER }),
      }),
    );
    // … reviews re-parented …
    expect(models.orderReview.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ customerId: LOSER }),
        data: expect.objectContaining({ customerId: WINNER }),
      }),
    );
    // … loser archived, survivor KPIs recomputed.
    expect(models.customer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
    );
    expect(models.order.aggregate).toHaveBeenCalled();
  });

  it("rejects merging a customer into itself", async () => {
    const { repo } = makeRepo();
    await expect(repo.merge(actor, WINNER, WINNER)).rejects.toBeInstanceOf(InvalidMergeError);
  });

  it("returns null when either customer is absent", async () => {
    const { repo, models } = makeRepo();
    models.customer.findFirst.mockResolvedValueOnce({ id: WINNER }).mockResolvedValueOnce(null);
    expect(await repo.merge(actor, WINNER, LOSER)).toBeNull();
  });
});

describe("merge completeness guard", () => {
  it("covers EVERY table that has a customerId foreign key", () => {
    // If a future model gains a `customerId`, this fails until the new table is
    // added to CUSTOMER_OWNED_TABLES and re-parented by merge() — so a
    // customer-owned table can never silently escape the merge (decision D5).
    const ownedByFk = Prisma.dmmf.datamodel.models
      .filter((m) => m.fields.some((f) => f.name === "customerId"))
      .map((m) => m.dbName ?? m.name)
      .sort();
    expect(ownedByFk).toEqual([...CUSTOMER_OWNED_TABLES].sort());
  });
});
