import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { FinanceService } from "../application/finance.service";
import type { SupplierView } from "../domain/finance.entity";
import { SuppliersController } from "./suppliers.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

function supplier(): SupplierView {
  return {
    id: "s1",
    name: "Acme Trading",
    phone: null,
    email: null,
    address: null,
    taxId: null,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function page<T>(rows: T[]): KeysetPage<T> {
  return { data: rows, page: { limit: 25, nextCursor: "c1", hasMore: true } };
}

function makeResponse(): Response & {
  status: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
} {
  return { status: vi.fn(), setHeader: vi.fn() } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
  };
}

type ServiceMock = { [K in keyof FinanceService]: ReturnType<typeof vi.fn> };

function makeService(): ServiceMock {
  return {
    listSuppliers: vi.fn().mockResolvedValue(page([supplier()])),
    getSupplier: vi.fn().mockResolvedValue(supplier()),
    createSupplier: vi.fn().mockResolvedValue(supplier()),
    updateSupplier: vi.fn().mockResolvedValue(supplier()),
    archiveSupplier: vi.fn().mockResolvedValue(undefined),
    listPurchaseOrders: vi.fn(),
    getPurchaseOrder: vi.fn(),
    createPurchaseOrder: vi.fn(),
    receivePurchaseOrder: vi.fn(),
    payPurchaseOrder: vi.fn(),
  } as unknown as ServiceMock;
}

describe("SuppliersController", () => {
  it("renders the keyset envelope", async () => {
    const service = makeService();
    const controller = new SuppliersController(service as unknown as FinanceService);
    const result = await controller.list(principal, { q: "acme" });
    expect(service.listSuppliers).toHaveBeenCalledWith(principal, { q: "acme" });
    expect(result.data[0]).toMatchObject({ id: "s1", name: "Acme Trading" });
    expect(result.page).toEqual({ limit: 25, nextCursor: "c1", hasMore: true });
  });

  it("returns 201 with a Location header on create", async () => {
    const service = makeService();
    const controller = new SuppliersController(service as unknown as FinanceService);
    const res = makeResponse();
    const dto = await controller.create(principal, { name: "Acme Trading" }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.setHeader).toHaveBeenCalledWith("Location", "/v1/finance/suppliers/s1");
    expect(dto.id).toBe("s1");
  });

  it("delegates detail, update, and archive with the path id", async () => {
    const service = makeService();
    const controller = new SuppliersController(service as unknown as FinanceService);
    await controller.getOne(principal, "s1");
    await controller.update(principal, "s1", { name: "New name" });
    await controller.archive(principal, "s1");
    expect(service.getSupplier).toHaveBeenCalledWith(principal, "s1");
    expect(service.updateSupplier).toHaveBeenCalledWith(principal, "s1", { name: "New name" });
    expect(service.archiveSupplier).toHaveBeenCalledWith(principal, "s1");
  });
});
