import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@cadeau/database";
import {
  DuplicateProductError,
  InvalidListCursorError,
  ReferenceNotFoundError,
} from "../domain/products.errors";
import { ProductsRepository } from "./products.repository";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const CREATED = new Date("2026-01-02T03:04:05.000Z");
const UPDATED = new Date("2026-01-03T03:04:05.000Z");

function productRow(extra: Record<string, unknown> = {}) {
  return {
    id: "p1",
    name: "Mug",
    description: null,
    categoryId: null,
    unitId: null,
    allowOversell: false,
    isActive: true,
    createdAt: CREATED,
    updatedAt: UPDATED,
    ...extra,
  };
}

function variantRow(extra: Record<string, unknown> = {}) {
  return {
    id: "v1",
    productId: "p1",
    name: "Red",
    sku: null,
    barcode: null,
    averageCost: 1500n,
    sellingPriceMinor: 2500n,
    isActive: true,
    createdAt: CREATED,
    updatedAt: UPDATED,
    ...extra,
  };
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
    product: delegate(),
    productVariant: delegate(),
    productCategory: delegate(),
    unit: delegate(),
  };
  const queryRaw = vi.fn().mockResolvedValue([]);
  const txHost = { $queryRaw: queryRaw, ...models };
  const prisma = {
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(txHost)),
  };
  const repo = new ProductsRepository(prisma as unknown as PrismaClient);
  return { repo, models, queryRaw };
}

describe("ProductsRepository — reads", () => {
  it("maps a product row to the public view and binds the RLS context", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.product.findFirst.mockResolvedValueOnce(productRow({ description: "d" }));
    const view = await repo.findById(COMPANY, "p1");
    expect(queryRaw).toHaveBeenCalled(); // setTenantContext ran
    expect(view).toMatchObject({
      id: "p1",
      name: "Mug",
      description: "d",
      active: true,
      allowOversell: false,
      createdAt: CREATED.toISOString(),
      variants: [],
    });
    expect(models.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1", companyId: COMPANY } }),
    );
  });

  it("findById returns null for an absent product", async () => {
    const { repo } = makeRepo();
    expect(await repo.findById(COMPANY, "nope")).toBeNull();
  });

  it("includes variants with averageCost coerced to a number", async () => {
    const { repo, models } = makeRepo();
    models.product.findFirst.mockResolvedValueOnce(productRow());
    models.productVariant.findMany.mockResolvedValueOnce([variantRow()]);
    const view = await repo.findById(COMPANY, "p1");
    expect(view?.variants[0]).toMatchObject({ id: "v1", averageCost: 1500 });
    expect(typeof view?.variants[0]?.averageCost).toBe("number");
  });

  it("narrows to products with sellable stock when hasStock is set (EPIC-9)", async () => {
    const { repo, models } = makeRepo();
    await repo.list(COMPANY, {
      sort: { field: "name", dir: "asc" },
      active: true,
      hasStock: true,
    });
    const args = models.product.findMany.mock.calls[0]?.[0];
    expect(args.where.variants).toEqual({ some: { stock: { some: { available: { gt: 0 } } } } });
  });

  it("list fetches one extra row for the keyset and scopes by company", async () => {
    const { repo, models } = makeRepo();
    await repo.list(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
      active: true,
      hasStock: false,
    });
    const args = models.product.findMany.mock.calls[0]?.[0];
    expect(args.take).toBe(26);
    expect(args.where).toMatchObject({ companyId: COMPANY, isActive: true });
  });

  it("list builds an OR search across name and variant sku/barcode", async () => {
    const { repo, models } = makeRepo();
    await repo.list(COMPANY, {
      sort: { field: "name", dir: "asc" },
      active: "all",
      hasStock: false,
      q: "mug",
    });
    const where = models.product.findMany.mock.calls[0]?.[0].where;
    expect(where.OR).toHaveLength(3);
    expect(where.isActive).toBeUndefined();
  });

  it("list selects nested variant stock/warehouse names and derives a distinct, sorted list", async () => {
    const { repo, models } = makeRepo();
    models.product.findMany.mockResolvedValueOnce([
      productRow({
        variants: [
          { stock: [{ warehouse: { name: "Cairo" } }, { warehouse: { name: "Alexandria" } }] },
          { stock: [{ warehouse: { name: "Cairo" } }] },
        ],
      }),
    ]);
    const page = await repo.list(COMPANY, {
      sort: { field: "name", dir: "asc" },
      active: true,
      hasStock: false,
    });
    expect(page.data[0]?.warehouseNames).toEqual(["Alexandria", "Cairo"]);
    const select = models.product.findMany.mock.calls[0]?.[0].select;
    expect(select.variants.select.stock.select.warehouse.select).toEqual({ name: true });
  });

  it("list yields no warehouse names for a product with no stock rows", async () => {
    const { repo, models } = makeRepo();
    models.product.findMany.mockResolvedValueOnce([productRow({ variants: [] })]);
    const page = await repo.list(COMPANY, {
      sort: { field: "name", dir: "asc" },
      active: true,
      hasStock: false,
    });
    expect(page.data[0]?.warehouseNames).toEqual([]);
  });

  it("listVariants returns null when the product is absent", async () => {
    const { repo } = makeRepo();
    expect(await repo.listVariants(COMPANY, "p9")).toBeNull();
  });
});

describe("ProductsRepository — writes + error mapping", () => {
  it("stamps the actor on create and returns the view", async () => {
    const { repo, models } = makeRepo();
    models.product.create.mockResolvedValueOnce(productRow());
    const view = await repo.create({ companyId: COMPANY, actorId: ACTOR }, { name: "Mug" });
    expect(view.id).toBe("p1");
    const data = models.product.create.mock.calls[0]?.[0].data;
    expect(data).toMatchObject({ name: "Mug", companyId: COMPANY, createdBy: ACTOR });
  });

  it("rejects a missing category reference with ReferenceNotFoundError", async () => {
    const { repo, models } = makeRepo();
    models.productCategory.findFirst.mockResolvedValueOnce(null);
    await expect(
      repo.create({ companyId: COMPANY, actorId: ACTOR }, { name: "Mug", categoryId: "c9" }),
    ).rejects.toBeInstanceOf(ReferenceNotFoundError);
    expect(models.product.create).not.toHaveBeenCalled();
  });

  it("maps a P2002 on sku to a DuplicateProductError('sku')", async () => {
    const { repo, models } = makeRepo();
    models.product.findFirst.mockResolvedValueOnce({ id: "p1" }); // product exists
    models.productVariant.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "6",
        meta: { target: "product_variants_company_sku_key" },
      }),
    );
    await expect(
      repo.createVariant({ companyId: COMPANY, actorId: ACTOR }, "p1", { name: "Red", sku: "X" }),
    ).rejects.toMatchObject({ field: "sku" });
  });

  it("maps a P2002 on the product name to a DuplicateProductError('name')", async () => {
    const { repo, models } = makeRepo();
    models.product.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "6",
        meta: { target: "products_company_name_key" },
      }),
    );
    await expect(
      repo.create({ companyId: COMPANY, actorId: ACTOR }, { name: "Mug" }),
    ).rejects.toBeInstanceOf(DuplicateProductError);
  });

  it("archive returns null when no row matches", async () => {
    const { repo } = makeRepo();
    expect(await repo.archive({ companyId: COMPANY, actorId: ACTOR }, "p9")).toBeNull();
  });

  it("createVariant returns null when the parent product is absent", async () => {
    const { repo, models } = makeRepo();
    models.product.findFirst.mockResolvedValueOnce(null);
    expect(
      await repo.createVariant({ companyId: COMPANY, actorId: ACTOR }, "p9", { name: "Red" }),
    ).toBeNull();
    expect(models.productVariant.create).not.toHaveBeenCalled();
  });

  it("maps a P2002 on barcode to a DuplicateProductError('barcode')", async () => {
    const { repo, models } = makeRepo();
    models.product.findFirst.mockResolvedValueOnce({ id: "p1" });
    models.productVariant.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "6",
        meta: { target: "product_variants_company_barcode_key" },
      }),
    );
    await expect(
      repo.createVariant({ companyId: COMPANY, actorId: ACTOR }, "p1", {
        name: "Red",
        barcode: "B",
      }),
    ).rejects.toMatchObject({ field: "barcode" });
  });

  it("rejects a missing unit reference", async () => {
    const { repo, models } = makeRepo();
    models.unit.findFirst.mockResolvedValueOnce(null);
    await expect(
      repo.create({ companyId: COMPANY, actorId: ACTOR }, { name: "Mug", unitId: "u9" }),
    ).rejects.toBeInstanceOf(ReferenceNotFoundError);
  });
});

describe("ProductsRepository — update, archive, variants", () => {
  it("update writes the patch and returns the refreshed view", async () => {
    const { repo, models } = makeRepo();
    models.product.updateMany.mockResolvedValueOnce({ count: 1 });
    models.product.findFirst.mockResolvedValueOnce(productRow({ name: "New" }));
    const view = await repo.update({ companyId: COMPANY, actorId: ACTOR }, "p1", { name: "New" });
    expect(view?.name).toBe("New");
    expect(models.product.updateMany.mock.calls[0]?.[0].data).toMatchObject({
      name: "New",
      updatedBy: ACTOR,
    });
  });

  it("update returns null when no row matches", async () => {
    const { repo, models } = makeRepo();
    models.product.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(
      await repo.update({ companyId: COMPANY, actorId: ACTOR }, "p9", { name: "x" }),
    ).toBeNull();
    expect(models.product.findFirst).not.toHaveBeenCalled();
  });

  it("archive sets isActive false and returns the view", async () => {
    const { repo, models } = makeRepo();
    models.product.updateMany.mockResolvedValueOnce({ count: 1 });
    models.product.findFirst.mockResolvedValueOnce(productRow({ isActive: false }));
    const view = await repo.archive({ companyId: COMPANY, actorId: ACTOR }, "p1");
    expect(view?.active).toBe(false);
    expect(models.product.updateMany.mock.calls[0]?.[0].data).toMatchObject({ isActive: false });
  });

  it("listVariants returns the variants of an existing product", async () => {
    const { repo, models } = makeRepo();
    models.product.findFirst.mockResolvedValueOnce({ id: "p1" });
    models.productVariant.findMany.mockResolvedValueOnce([variantRow()]);
    const variants = await repo.listVariants(COMPANY, "p1");
    expect(variants).toHaveLength(1);
    expect(variants?.[0]?.averageCost).toBe(1500);
  });

  it("updateVariant patches only provided fields and refreshes", async () => {
    const { repo, models } = makeRepo();
    models.productVariant.updateMany.mockResolvedValueOnce({ count: 1 });
    models.productVariant.findFirst.mockResolvedValueOnce(variantRow({ name: "Blue", sku: "S2" }));
    const view = await repo.updateVariant({ companyId: COMPANY, actorId: ACTOR }, "p1", "v1", {
      name: "Blue",
      sku: "S2",
      barcode: null,
      active: false,
    });
    expect(view?.name).toBe("Blue");
    const data = models.productVariant.updateMany.mock.calls[0]?.[0].data;
    expect(data).toMatchObject({ name: "Blue", sku: "S2", barcode: null, isActive: false });
  });

  it("updateVariant returns null when absent", async () => {
    const { repo, models } = makeRepo();
    models.productVariant.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(
      await repo.updateVariant({ companyId: COMPANY, actorId: ACTOR }, "p1", "v9", { name: "x" }),
    ).toBeNull();
  });
});

describe("ProductsRepository — keyset pagination", () => {
  it("emits a nextCursor when more rows exist (createdAt sort)", async () => {
    const { repo, models } = makeRepo();
    const rows = Array.from({ length: 26 }, (_, i) =>
      productRow({ id: `p${i}`, createdAt: new Date(2026, 0, i + 1) }),
    );
    models.product.findMany.mockResolvedValueOnce(rows);
    const pageResult = await repo.list(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
      active: true,
      hasStock: false,
      limit: 25,
    });
    expect(pageResult.data).toHaveLength(25);
    expect(pageResult.page.hasMore).toBe(true);
    expect(pageResult.page.nextCursor).not.toBeNull();
  });

  it("applies a decoded cursor to the keyset predicate (name asc)", async () => {
    const { repo, models } = makeRepo();
    const cursor = Buffer.from(JSON.stringify({ p: "Mug", t: "p1" }), "utf8").toString("base64url");
    await repo.list(COMPANY, {
      sort: { field: "name", dir: "asc" },
      active: true,
      hasStock: false,
      cursor,
    });
    const where = models.product.findMany.mock.calls[0]?.[0].where;
    expect(where.AND?.[0].OR).toBeDefined();
  });

  it("rejects a malformed cursor", async () => {
    const { repo } = makeRepo();
    await expect(
      repo.list(COMPANY, {
        sort: { field: "createdAt", dir: "desc" },
        active: true,
        hasStock: false,
        cursor: "%%%",
      }),
    ).rejects.toBeInstanceOf(InvalidListCursorError);
  });
});

describe("ProductsRepository — findVariantBySku", () => {
  it("returns the matching active variant, with sellingPriceMinor coerced to a number", async () => {
    const { repo, models } = makeRepo();
    models.productVariant.findFirst.mockResolvedValueOnce(variantRow({ sku: "SKU-1" }));
    const view = await repo.findVariantBySku(COMPANY, "SKU-1");
    expect(view).toMatchObject({ id: "v1", sku: "SKU-1", sellingPriceMinor: 2500 });
    expect(models.productVariant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: COMPANY, sku: "SKU-1", isActive: true } }),
    );
  });

  it("returns null when no active variant matches", async () => {
    const { repo, models } = makeRepo();
    models.productVariant.findFirst.mockResolvedValueOnce(null);
    expect(await repo.findVariantBySku(COMPANY, "NOPE")).toBeNull();
  });
});
