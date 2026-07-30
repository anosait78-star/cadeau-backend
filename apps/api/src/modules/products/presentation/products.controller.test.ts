import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type {
  ProductVariantView,
  ProductView,
  ProductWithVariants,
} from "../domain/product.entity";
import type { ProductsService } from "../application/products.service";
import { ProductsController } from "./products.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

function product(id: string): ProductView {
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
  };
}

function variant(id: string): ProductVariantView {
  return {
    id,
    productId: "p1",
    name: "Red",
    sku: "SKU-1",
    barcode: null,
    averageCost: 0,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function page(rows: ProductView[]): KeysetPage<ProductView> {
  return { data: rows, page: { limit: 25, nextCursor: null, hasMore: false } };
}

/** A fully-mocked service: every public method replaced by a vitest mock fn. */
type ServiceMock = { [K in keyof ProductsService]: ReturnType<typeof vi.fn> };

describe("ProductsController", () => {
  let service: ServiceMock;
  let controller: ProductsController;

  beforeEach(() => {
    service = {
      list: vi.fn().mockResolvedValue(page([product("p1")])),
      getOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      archive: vi.fn().mockResolvedValue(undefined),
      listVariants: vi.fn(),
      createVariant: vi.fn(),
      updateVariant: vi.fn(),
    };
    controller = new ProductsController(service as unknown as ProductsService);
  });

  it("maps the list to the envelope DTO", async () => {
    const dto = await controller.list(principal, { active: "all" });
    expect(dto.data[0]).toMatchObject({ id: "p1", name: "Mug" });
    expect(dto.page).toEqual({ limit: 25, nextCursor: null, hasMore: false });
    expect(service.list).toHaveBeenCalledWith(principal, { active: "all" });
  });

  it("getOne maps the detail with variants", async () => {
    const detail: ProductWithVariants = { ...product("p1"), variants: [variant("v1")] };
    service.getOne.mockResolvedValue(detail);
    const dto = await controller.getOne(principal, "p1");
    expect(dto.variants[0]).toMatchObject({ id: "v1", sku: "SKU-1", averageCost: 0 });
  });

  it("create sets 201 + Location and returns the DTO", async () => {
    service.create.mockResolvedValue(product("new"));
    const res = { status: vi.fn(), setHeader: vi.fn() } as unknown as Response;
    const dto = await controller.create(principal, { name: "Mug" }, res);
    expect(dto.id).toBe("new");
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.setHeader).toHaveBeenCalledWith("Location", "/v1/products/new");
  });

  it("createVariant sets 201 + nested Location", async () => {
    service.createVariant.mockResolvedValue(variant("v1"));
    const res = { status: vi.fn(), setHeader: vi.fn() } as unknown as Response;
    const dto = await controller.createVariant(principal, "p1", { name: "Red" }, res);
    expect(dto.id).toBe("v1");
    expect(res.setHeader).toHaveBeenCalledWith("Location", "/v1/products/p1/variants/v1");
  });

  it("update delegates and returns the DTO", async () => {
    service.update.mockResolvedValue(product("p1"));
    const dto = await controller.update(principal, "p1", { name: "New" });
    expect(dto.id).toBe("p1");
    expect(service.update).toHaveBeenCalledWith(principal, "p1", { name: "New" });
  });

  it("archive delegates to the service", async () => {
    await controller.archive(principal, "p1");
    expect(service.archive).toHaveBeenCalledWith(principal, "p1");
  });

  it("listVariants maps to the collection DTO", async () => {
    service.listVariants.mockResolvedValue([variant("v1")]);
    const dto = await controller.listVariants(principal, "p1");
    expect(dto.data).toHaveLength(1);
  });
});
