import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { FinanceService } from "../application/finance.service";
import type {
  PurchaseOrderPaymentView,
  PurchaseOrderReceiptView,
  PurchaseOrderView,
} from "../domain/finance.entity";
import { PurchaseOrdersController } from "./purchase-orders.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

function order(): PurchaseOrderView {
  return {
    id: "po1",
    number: 1,
    supplierId: "s1",
    status: "ordered",
    expectedDate: null,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lines: [
      { id: "l1", variantId: "v1", quantityOrdered: 10, quantityReceived: 0, unitCost: 1000 },
    ],
  };
}

function receipt(): PurchaseOrderReceiptView {
  return {
    id: "r1",
    poId: "po1",
    warehouseId: "w1",
    receivedAt: "2026-01-01T00:00:00.000Z",
    lines: [{ id: "rl1", poLineId: "l1", quantity: 5 }],
  };
}

function payment(): PurchaseOrderPaymentView {
  return {
    id: "p1",
    poId: "po1",
    amountMinor: 5000,
    method: "cash",
    paidAt: "2026-01-01T00:00:00.000Z",
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
    listSuppliers: vi.fn(),
    getSupplier: vi.fn(),
    createSupplier: vi.fn(),
    updateSupplier: vi.fn(),
    archiveSupplier: vi.fn(),
    listPurchaseOrders: vi.fn().mockResolvedValue(page([order()])),
    getPurchaseOrder: vi.fn().mockResolvedValue(order()),
    createPurchaseOrder: vi.fn().mockResolvedValue(order()),
    receivePurchaseOrder: vi.fn().mockResolvedValue(receipt()),
    payPurchaseOrder: vi.fn().mockResolvedValue(payment()),
  } as unknown as ServiceMock;
}

describe("PurchaseOrdersController", () => {
  it("renders the keyset envelope for the list", async () => {
    const service = makeService();
    const controller = new PurchaseOrdersController(service as unknown as FinanceService);
    const result = await controller.list(principal, { status: "ordered" });
    expect(service.listPurchaseOrders).toHaveBeenCalledWith(principal, { status: "ordered" });
    expect(result.data[0]).toMatchObject({ id: "po1", number: 1 });
  });

  it("renders the detail with lines", async () => {
    const service = makeService();
    const controller = new PurchaseOrdersController(service as unknown as FinanceService);
    const dto = await controller.getOne(principal, "po1");
    expect(service.getPurchaseOrder).toHaveBeenCalledWith(principal, "po1");
    expect(dto.lines).toHaveLength(1);
  });

  it("creates a PO, forwarding the idempotency key, and sets Location", async () => {
    const service = makeService();
    const controller = new PurchaseOrdersController(service as unknown as FinanceService);
    const res = makeResponse();
    const dto = await controller.create(
      principal,
      { supplierId: "s1", lines: [{ variantId: "v1", quantityOrdered: 10, unitCost: 1000 }] },
      "key-1",
      res,
    );
    expect(service.createPurchaseOrder).toHaveBeenCalledWith(principal, {
      supplierId: "s1",
      lines: [{ variantId: "v1", quantityOrdered: 10, unitCost: 1000 }],
      idempotencyKey: "key-1",
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.setHeader).toHaveBeenCalledWith("Location", "/v1/finance/purchase-orders/po1");
    expect(dto.id).toBe("po1");
  });

  it("creates a PO without an idempotency key when the header is absent", async () => {
    const service = makeService();
    const controller = new PurchaseOrdersController(service as unknown as FinanceService);
    await controller.create(principal, { supplierId: "s1", lines: [] }, undefined, makeResponse());
    expect(service.createPurchaseOrder).toHaveBeenCalledWith(principal, {
      supplierId: "s1",
      lines: [],
    });
  });

  it("records a receipt and returns 201", async () => {
    const service = makeService();
    const controller = new PurchaseOrdersController(service as unknown as FinanceService);
    const res = makeResponse();
    const dto = await controller.receive(
      principal,
      "po1",
      { warehouseId: "w1", lines: [{ poLineId: "l1", quantity: 5 }] },
      "key-2",
      res,
    );
    expect(service.receivePurchaseOrder).toHaveBeenCalledWith(principal, "po1", {
      warehouseId: "w1",
      lines: [{ poLineId: "l1", quantity: 5 }],
      idempotencyKey: "key-2",
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(dto.lines).toHaveLength(1);
  });

  it("records a receipt without an idempotency key when the header is absent", async () => {
    const service = makeService();
    const controller = new PurchaseOrdersController(service as unknown as FinanceService);
    await controller.receive(
      principal,
      "po1",
      { warehouseId: "w1", lines: [{ poLineId: "l1", quantity: 5 }] },
      undefined,
      makeResponse(),
    );
    expect(service.receivePurchaseOrder).toHaveBeenCalledWith(principal, "po1", {
      warehouseId: "w1",
      lines: [{ poLineId: "l1", quantity: 5 }],
    });
  });

  it("records a payment and returns 201", async () => {
    const service = makeService();
    const controller = new PurchaseOrdersController(service as unknown as FinanceService);
    const res = makeResponse();
    const dto = await controller.pay(
      principal,
      "po1",
      { amountMinor: 5000, method: "cash" },
      "key-3",
      res,
    );
    expect(service.payPurchaseOrder).toHaveBeenCalledWith(principal, "po1", {
      amountMinor: 5000,
      method: "cash",
      idempotencyKey: "key-3",
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(dto.amountMinor).toBe(5000);
  });

  it("records a payment without an idempotency key when the header is absent", async () => {
    const service = makeService();
    const controller = new PurchaseOrdersController(service as unknown as FinanceService);
    await controller.pay(
      principal,
      "po1",
      { amountMinor: 5000, method: "cash" },
      undefined,
      makeResponse(),
    );
    expect(service.payPurchaseOrder).toHaveBeenCalledWith(principal, "po1", {
      amountMinor: 5000,
      method: "cash",
    });
  });
});
