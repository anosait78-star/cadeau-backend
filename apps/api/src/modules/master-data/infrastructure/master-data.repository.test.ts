import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@cadeau/database";
import { findResource } from "../domain/resource-registry";
import type { ResourceDescriptor } from "../domain/resource.types";
import {
  DuplicateResourceError,
  InvalidListCursorError,
  ReferenceNotFoundError,
} from "../domain/master-data.errors";
import { MasterDataRepository } from "./master-data.repository";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const CREATED = new Date("2026-01-02T03:04:05.000Z");
const UPDATED = new Date("2026-01-03T03:04:05.000Z");

function resource(name: string): ResourceDescriptor {
  const descriptor = findResource(name);
  if (descriptor === undefined) throw new Error(`missing test resource ${name}`);
  return descriptor;
}

function delegate() {
  return {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
}

function makeRepo() {
  const models = {
    orderLabel: delegate(),
    currency: delegate(),
    productCategory: delegate(),
  };
  const txQueryRaw = vi.fn().mockResolvedValue([]);
  const txHost = { $queryRaw: txQueryRaw, ...models };
  const prisma = {
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(txHost)),
    ...models,
  };
  const repo = new MasterDataRepository(prisma as unknown as PrismaClient);
  return { repo, models, txQueryRaw };
}

describe("MasterDataRepository — reads + views", () => {
  it("maps a row to the public view (tenant)", async () => {
    const { repo, models } = makeRepo();
    models.orderLabel.findFirst.mockResolvedValueOnce({
      id: "l1",
      isActive: true,
      createdAt: CREATED,
      updatedAt: UPDATED,
      name: "VIP",
      color: "#E11931",
    });
    const view = await repo.findById(resource("order-labels"), COMPANY, "l1");
    expect(view).toEqual({
      id: "l1",
      active: true,
      createdAt: CREATED.toISOString(),
      updatedAt: UPDATED.toISOString(),
      name: "VIP",
      color: "#E11931",
    });
  });

  it("scopes a tenant findById by company and binds the RLS context", async () => {
    const { repo, models, txQueryRaw } = makeRepo();
    await repo.findById(resource("order-labels"), COMPANY, "l1");
    expect(txQueryRaw).toHaveBeenCalled(); // setTenantContext ran
    expect(models.orderLabel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "l1", companyId: COMPANY } }),
    );
  });

  it("reads a system resource without a tenant scope or transaction", async () => {
    const { repo, models, txQueryRaw } = makeRepo();
    await repo.findById(resource("currencies"), null, "EGP");
    expect(txQueryRaw).not.toHaveBeenCalled();
    expect(models.currency.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: "EGP" } }),
    );
  });

  it("builds the active-only, name-sorted list query with the extra keyset row", async () => {
    const { repo, models } = makeRepo();
    await repo.list(resource("order-labels"), COMPANY, {
      sort: { field: "name", dir: "asc" },
      active: true,
      filters: {},
    });
    expect(models.orderLabel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: COMPANY, isActive: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 26,
      }),
    );
  });

  it("adds a keyset predicate when a cursor is supplied", async () => {
    const { repo, models } = makeRepo();
    // encode a cursor by paging once
    models.orderLabel.findMany.mockResolvedValueOnce(
      Array.from({ length: 26 }, (_, i) => ({
        id: `id${i}`,
        isActive: true,
        createdAt: CREATED,
        updatedAt: UPDATED,
        name: `n${i}`,
        color: null,
      })),
    );
    const page = await repo.list(resource("order-labels"), COMPANY, {
      sort: { field: "name", dir: "asc" },
      active: true,
      filters: {},
    });
    expect(page.page.hasMore).toBe(true);
    expect(page.page.nextCursor).not.toBeNull();

    await repo.list(resource("order-labels"), COMPANY, {
      sort: { field: "name", dir: "asc" },
      active: true,
      filters: {},
      cursor: page.page.nextCursor as string,
    });
    const secondCall = models.orderLabel.findMany.mock.calls[1]?.[0] as {
      where: { AND: unknown[] };
    };
    expect(secondCall.where.AND).toBeDefined();
  });

  it("rejects a malformed cursor", async () => {
    const { repo } = makeRepo();
    await expect(
      repo.list(resource("order-labels"), COMPANY, {
        sort: { field: "name", dir: "asc" },
        active: true,
        filters: {},
        cursor: "!!!not-base64!!!",
      }),
    ).rejects.toBeInstanceOf(InvalidListCursorError);
  });

  it("listActive returns all active rows without pagination", async () => {
    const { repo, models } = makeRepo();
    models.orderLabel.findMany.mockResolvedValueOnce([
      { id: "l1", isActive: true, createdAt: CREATED, updatedAt: UPDATED, name: "A", color: null },
    ]);
    const rows = await repo.listActive(resource("order-labels"), COMPANY);
    expect(rows).toHaveLength(1);
    const args = models.orderLabel.findMany.mock.calls[0]?.[0] as { where: object; take?: number };
    expect(args.where).toEqual({ companyId: COMPANY, isActive: true });
    expect(args.take).toBeUndefined();
  });

  it("lists a system resource with no tenant scope", async () => {
    const { repo, models, txQueryRaw } = makeRepo();
    await repo.list(resource("currencies"), null, {
      sort: { field: "name", dir: "asc" },
      active: true,
      filters: {},
    });
    expect(txQueryRaw).not.toHaveBeenCalled();
    const args = models.currency.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where["companyId"]).toBeUndefined();
    expect(args.where["isActive"]).toBe(true);
  });

  it("omits the active filter when active is 'all'", async () => {
    const { repo, models } = makeRepo();
    await repo.list(resource("order-labels"), COMPANY, {
      sort: { field: "name", dir: "asc" },
      active: "all",
      filters: {},
    });
    const args = models.orderLabel.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect("isActive" in args.where).toBe(false);
  });

  it("rejects a cursor with a non-date primary when sorting by createdAt", async () => {
    const { repo } = makeRepo();
    const cursor = Buffer.from(JSON.stringify({ p: "not-a-date", t: "id0" }), "utf8").toString(
      "base64url",
    );
    await expect(
      repo.list(resource("order-labels"), COMPANY, {
        sort: { field: "createdAt", dir: "desc" },
        active: true,
        filters: {},
        cursor,
      }),
    ).rejects.toBeInstanceOf(InvalidListCursorError);
  });

  it("applies search over the resource's searchable fields", async () => {
    const { repo, models } = makeRepo();
    await repo.list(resource("order-labels"), COMPANY, {
      sort: { field: "name", dir: "asc" },
      active: true,
      q: "vip",
      filters: {},
    });
    const args = models.orderLabel.findMany.mock.calls[0]?.[0] as { where: { OR: unknown[] } };
    expect(args.where.OR).toEqual([{ name: { contains: "vip", mode: "insensitive" } }]);
  });
});

describe("MasterDataRepository — writes", () => {
  it("stamps create data with the tenant + actor", async () => {
    const { repo, models } = makeRepo();
    models.orderLabel.create.mockResolvedValueOnce({
      id: "l1",
      isActive: true,
      createdAt: CREATED,
      updatedAt: UPDATED,
      name: "VIP",
      color: null,
    });
    await repo.create(
      resource("order-labels"),
      { companyId: COMPANY, actorId: ACTOR },
      {
        name: "VIP",
      },
    );
    expect(models.orderLabel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: "VIP", companyId: COMPANY, createdBy: ACTOR, updatedBy: ACTOR },
      }),
    );
  });

  it("maps a P2002 unique violation to DuplicateResourceError", async () => {
    const { repo, models } = makeRepo();
    models.orderLabel.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6" }),
    );
    await expect(
      repo.create(
        resource("order-labels"),
        { companyId: COMPANY, actorId: ACTOR },
        { name: "VIP" },
      ),
    ).rejects.toBeInstanceOf(DuplicateResourceError);
  });

  it("rejects a create whose tenant reference is missing", async () => {
    const { repo, models } = makeRepo();
    models.productCategory.findFirst.mockResolvedValueOnce(null); // parent lookup misses
    await expect(
      repo.create(
        resource("product-categories"),
        { companyId: COMPANY, actorId: ACTOR },
        {
          name: "Shoes",
          parentId: "33333333-3333-3333-3333-333333333333",
        },
      ),
    ).rejects.toBeInstanceOf(ReferenceNotFoundError);
    expect(models.productCategory.create).not.toHaveBeenCalled();
  });

  it("returns null when updating an absent row", async () => {
    const { repo, models } = makeRepo();
    models.orderLabel.updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await repo.update(
      resource("order-labels"),
      { companyId: COMPANY, actorId: ACTOR },
      "missing",
      { name: "x" },
    );
    expect(result).toBeNull();
  });

  it("updates then re-reads the row", async () => {
    const { repo, models } = makeRepo();
    models.orderLabel.updateMany.mockResolvedValueOnce({ count: 1 });
    models.orderLabel.findFirst.mockResolvedValueOnce({
      id: "l1",
      isActive: true,
      createdAt: CREATED,
      updatedAt: UPDATED,
      name: "new",
      color: null,
    });
    const result = await repo.update(
      resource("order-labels"),
      { companyId: COMPANY, actorId: ACTOR },
      "l1",
      { name: "new" },
    );
    expect(result?.["name"]).toBe("new");
    expect(models.orderLabel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "l1", companyId: COMPANY },
        data: { name: "new", updatedBy: ACTOR },
      }),
    );
  });

  it("deactivate sets is_active false", async () => {
    const { repo, models } = makeRepo();
    models.orderLabel.updateMany.mockResolvedValueOnce({ count: 1 });
    models.orderLabel.findFirst.mockResolvedValueOnce({
      id: "l1",
      isActive: false,
      createdAt: CREATED,
      updatedAt: UPDATED,
      name: "VIP",
      color: null,
    });
    const result = await repo.deactivate(
      resource("order-labels"),
      { companyId: COMPANY, actorId: ACTOR },
      "l1",
    );
    expect(result?.active).toBe(false);
    expect(models.orderLabel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false, updatedBy: ACTOR } }),
    );
  });
});
