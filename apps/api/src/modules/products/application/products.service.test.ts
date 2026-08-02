import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppException } from "../../../shared/errors/app-exception";
import type { EventBusPort } from "../../../shared/events/event-bus.port";
import type { Clock } from "../../../shared/time/clock";
import type { ProductVariantView, ProductView } from "../domain/product.entity";
import type { ProductsAuditPort } from "../domain/products-audit.port";
import type { ProductsRepositoryPort } from "../domain/products-repository.port";
import {
  DuplicateProductError,
  InvalidListCursorError,
  ReferenceNotFoundError,
} from "../domain/products.errors";
import { ProductsService } from "./products.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

function principal(overrides: Partial<RequestPrincipal> = {}): RequestPrincipal {
  return { userId: USER, sessionId: "s", companyId: COMPANY, ...overrides };
}

function product(id: string, extra: Partial<ProductView> = {}): ProductView {
  return {
    id,
    name: "Mug",
    description: null,
    categoryId: null,
    unitId: null,
    allowOversell: false,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function variant(id: string, extra: Partial<ProductVariantView> = {}): ProductVariantView {
  return {
    id,
    productId: "p1",
    name: "Red",
    sku: null,
    barcode: null,
    averageCost: 0,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function emptyPage(): KeysetPage<ProductView> {
  return { data: [], page: { limit: 25, nextCursor: null, hasMore: false } };
}

interface Harness {
  service: ProductsService;
  repo: Record<keyof ProductsRepositoryPort, ReturnType<typeof vi.fn>>;
  audit: { record: ReturnType<typeof vi.fn> };
  events: { publish: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };
}

function makeHarness(): Harness {
  const repo = {
    list: vi.fn().mockResolvedValue(emptyPage()),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    listVariants: vi.fn(),
    createVariant: vi.fn(),
    updateVariant: vi.fn(),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const events = { publish: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn() };
  const clock: Clock = { now: () => 1_700_000_000_000 };
  const service = new ProductsService(
    repo as unknown as ProductsRepositoryPort,
    audit as unknown as ProductsAuditPort,
    events as unknown as EventBusPort,
    clock,
  );
  return { service, repo, audit, events };
}

describe("ProductsService reads", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("lists scoped to the company", async () => {
    await h.service.list(principal(), {});
    expect(h.repo.list).toHaveBeenCalledWith(COMPANY, expect.anything());
  });

  it("requires an active company", async () => {
    await expect(h.service.list(principal({ companyId: null }), {})).rejects.toMatchObject({
      status: 403,
    });
  });

  it("rejects an invalid list query with 400", async () => {
    await expect(h.service.list(principal(), { sort: "bogus" })).rejects.toBeInstanceOf(
      AppException,
    );
    expect(h.repo.list).not.toHaveBeenCalled();
  });

  it("maps a repo InvalidListCursorError to 400", async () => {
    h.repo.list.mockRejectedValueOnce(new InvalidListCursorError());
    await expect(h.service.list(principal(), { cursor: "bad" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("getOne returns the product or 404", async () => {
    h.repo.findById.mockResolvedValueOnce({ ...product("p1"), variants: [] });
    expect((await h.service.getOne(principal(), "p1")).id).toBe("p1");
    h.repo.findById.mockResolvedValueOnce(null);
    await expect(h.service.getOne(principal(), "p2")).rejects.toMatchObject({ status: 404 });
  });

  it("listVariants returns variants or 404 for an absent product", async () => {
    h.repo.listVariants.mockResolvedValueOnce([variant("v1")]);
    expect(await h.service.listVariants(principal(), "p1")).toHaveLength(1);
    h.repo.listVariants.mockResolvedValueOnce(null);
    await expect(h.service.listVariants(principal(), "p9")).rejects.toMatchObject({ status: 404 });
  });
});

describe("ProductsService writes", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("creates, audits, and emits product.created", async () => {
    h.repo.create.mockResolvedValue(product("new"));
    const created = await h.service.create(principal(), { name: "Mug" });
    expect(created.id).toBe("new");
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "product.created",
        entityType: "product",
        entityId: "new",
      }),
    );
    expect(h.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "product.created",
        companyId: COMPANY,
        actorId: USER,
        payload: { productId: "new" },
      }),
    );
  });

  it("audit precedes the event emission", async () => {
    const order: string[] = [];
    h.repo.create.mockResolvedValue(product("new"));
    h.audit.record.mockImplementation(() => {
      order.push("audit");
      return Promise.resolve();
    });
    h.events.publish.mockImplementation(() => {
      order.push("event");
      return Promise.resolve();
    });
    await h.service.create(principal(), { name: "Mug" });
    expect(order).toEqual(["audit", "event"]);
  });

  it("maps a duplicate name to 409 and skips audit", async () => {
    h.repo.create.mockRejectedValue(new DuplicateProductError("name"));
    await expect(h.service.create(principal(), { name: "Mug" })).rejects.toMatchObject({
      status: 409,
    });
    expect(h.audit.record).not.toHaveBeenCalled();
  });

  it("maps a bad category reference to 422", async () => {
    h.repo.create.mockRejectedValue(new ReferenceNotFoundError("categoryId"));
    await expect(
      h.service.create(principal(), { name: "Mug", categoryId: "x" }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("update returns 404 when the product is absent", async () => {
    h.repo.update.mockResolvedValue(null);
    await expect(h.service.update(principal(), "p1", { name: "y" })).rejects.toMatchObject({
      status: 404,
    });
    expect(h.audit.record).not.toHaveBeenCalled();
  });

  it("update emits product.updated", async () => {
    h.repo.update.mockResolvedValue(product("p1", { name: "y" }));
    await h.service.update(principal(), "p1", { name: "y" });
    expect(h.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "product.updated", payload: { productId: "p1" } }),
    );
  });

  it("archive soft-deletes and emits product.archived, or 404", async () => {
    h.repo.archive.mockResolvedValueOnce(product("p1", { active: false }));
    await h.service.archive(principal(), "p1");
    expect(h.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "product.archived", payload: { productId: "p1" } }),
    );
    h.repo.archive.mockResolvedValueOnce(null);
    await expect(h.service.archive(principal(), "p9")).rejects.toMatchObject({ status: 404 });
  });

  it("createVariant audits the variant and emits product.updated on the parent", async () => {
    h.repo.createVariant.mockResolvedValue(variant("v1"));
    const v = await h.service.createVariant(principal(), "p1", { name: "Red" });
    expect(v.id).toBe("v1");
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "product.variant_created", entityType: "product_variant" }),
    );
    expect(h.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "product.updated", payload: { productId: "p1" } }),
    );
  });

  it("createVariant returns 404 for an absent product", async () => {
    h.repo.createVariant.mockResolvedValue(null);
    await expect(h.service.createVariant(principal(), "p9", { name: "Red" })).rejects.toMatchObject(
      { status: 404 },
    );
  });

  it("maps a duplicate sku to 409", async () => {
    h.repo.createVariant.mockRejectedValue(new DuplicateProductError("sku"));
    await expect(
      h.service.createVariant(principal(), "p1", { name: "Red", sku: "DUP" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("updateVariant returns 404 when absent, emits product.updated otherwise", async () => {
    h.repo.updateVariant.mockResolvedValueOnce(null);
    await expect(
      h.service.updateVariant(principal(), "p1", "v9", { name: "x" }),
    ).rejects.toMatchObject({ status: 404 });

    h.repo.updateVariant.mockResolvedValueOnce(variant("v1", { name: "x" }));
    await h.service.updateVariant(principal(), "p1", "v1", { name: "x" });
    expect(h.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "product.updated", payload: { productId: "p1" } }),
    );
  });
});

describe("ProductsService.importProducts", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  const mapping = { name: "name", sku: "sku" };

  it("creates one product per valid row, and a variant when sku is mapped", async () => {
    h.repo.create.mockResolvedValueOnce(product("p1", { name: "Mug" }));
    h.repo.createVariant.mockResolvedValueOnce(variant("v1"));
    const csv = "name,sku\nMug,MUG-1";

    const { results } = await h.service.importProducts(principal(), csv, mapping);

    expect(results).toEqual([{ row: 1, ok: true, productId: "p1" }]);
    expect(h.repo.create).toHaveBeenCalledWith(
      { companyId: COMPANY, actorId: USER },
      { name: "Mug", description: null, categoryId: null, unitId: null },
    );
    expect(h.repo.createVariant).toHaveBeenCalledWith({ companyId: COMPANY, actorId: USER }, "p1", {
      name: "Mug",
      sku: "MUG-1",
      barcode: null,
    });
  });

  it("skips variant creation when sku/barcode are not mapped", async () => {
    h.repo.create.mockResolvedValueOnce(product("p1"));
    const { results } = await h.service.importProducts(principal(), "name\nMug", { name: "name" });
    expect(results).toEqual([{ row: 1, ok: true, productId: "p1" }]);
    expect(h.repo.createVariant).not.toHaveBeenCalled();
  });

  it("reports a mapping error without calling the repo", async () => {
    const csv = "name,sku\n,MUG-1"; // missing name
    const { results } = await h.service.importProducts(principal(), csv, mapping);
    expect(results).toEqual([
      { row: 1, ok: false, error: { code: "UNPROCESSABLE_ENTITY", message: "Missing name." } },
    ]);
    expect(h.repo.create).not.toHaveBeenCalled();
  });

  it("continues past a row that fails to create, reporting its error", async () => {
    h.repo.create
      .mockRejectedValueOnce(new DuplicateProductError("name"))
      .mockResolvedValueOnce(product("p2", { name: "Bowl" }));
    const csv = "name\nMug\nBowl";

    const { results } = await h.service.importProducts(principal(), csv, { name: "name" });

    expect(results).toEqual([
      { row: 1, ok: false, error: { code: "CONFLICT", message: expect.any(String) } },
      { row: 2, ok: true, productId: "p2" },
    ]);
  });

  it("rejects when the mapped row count exceeds the row limit", async () => {
    const header = "name\n";
    const rows = Array.from({ length: 1001 }, (_, i) => `p${i}`).join("\n");
    await expect(
      h.service.importProducts(principal(), header + rows, { name: "name" }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
