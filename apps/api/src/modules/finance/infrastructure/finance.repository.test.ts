/**
 * Happy-path coverage for the finance repository (EPIC-13, M13.2): supplier
 * CRUD, purchase-order create/list/detail, the atomic receipt (including the
 * moving-average roll, D7), and payments. Edge cases (idempotency replays,
 * locking races, over-receipt, illegal PO state, bad cursors) live in
 * `finance.repository.edge.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@cadeau/database";
import { EmptyPurchaseOrderError, ReferenceNotFoundError } from "../domain/finance.errors";
import { FinanceRepository } from "./finance.repository";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const SUPPLIER = "33333333-3333-3333-3333-333333333333";
const VARIANT = "55555555-5555-5555-5555-555555555555";
const WAREHOUSE = "66666666-6666-6666-6666-666666666666";
const PO = "77777777-7777-7777-7777-777777777777";
const LINE1 = "88888888-8888-8888-8888-888888888888";
const RECEIPT = "99999999-9999-9999-9999-999999999999";
const ACTOR_CTX = { companyId: COMPANY, actorId: ACTOR };
const NOW = new Date("2026-01-02T03:04:05.000Z");

function supplierRow(extra: Record<string, unknown> = {}) {
  return {
    id: SUPPLIER,
    name: "Acme Trading",
    phone: null,
    email: null,
    address: null,
    taxId: null,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

function poLineRow(extra: Record<string, unknown> = {}) {
  return {
    id: LINE1,
    variantId: VARIANT,
    quantityOrdered: 10n,
    quantityReceived: 0n,
    unitCost: 1000n,
    ...extra,
  };
}

function poDetailRow(extra: Record<string, unknown> = {}) {
  return {
    id: PO,
    number: 1n,
    supplierId: SUPPLIER,
    status: "ordered",
    expectedDate: null,
    notes: null,
    createdAt: NOW,
    updatedAt: NOW,
    lines: [poLineRow()],
    ...extra,
  };
}

function receiptRow(extra: Record<string, unknown> = {}) {
  return {
    id: RECEIPT,
    poId: PO,
    warehouseId: WAREHOUSE,
    receivedAt: NOW,
    lines: [{ id: "rl1", poLineId: LINE1, quantity: 5n }],
    ...extra,
  };
}

function paymentRow(extra: Record<string, unknown> = {}) {
  return { id: "pay1", poId: PO, amountMinor: 5000n, method: "cash", paidAt: NOW, ...extra };
}

function delegate() {
  return {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findFirstOrThrow: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn().mockResolvedValue({ id: "stock1" }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
}

function makeRepo() {
  const models = {
    supplier: delegate(),
    purchaseOrder: delegate(),
    purchaseOrderLine: delegate(),
    purchaseOrderReceipt: delegate(),
    purchaseOrderReceiptLine: delegate(),
    purchaseOrderPayment: delegate(),
    inventoryStock: delegate(),
    productVariant: delegate(),
    warehouse: delegate(),
    stockAdjustment: delegate(),
  };
  const queryRaw = vi.fn().mockResolvedValue([]);
  const txHost = { $queryRaw: queryRaw, ...models };
  const prisma = { $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(txHost)) };
  return { repo: new FinanceRepository(prisma as unknown as PrismaClient), models, queryRaw };
}

describe("FinanceRepository — suppliers", () => {
  it("creates a supplier", async () => {
    const { repo, models } = makeRepo();
    models.supplier.create.mockResolvedValue(supplierRow());
    const row = await repo.createSupplier(ACTOR_CTX, { name: "Acme Trading" });
    expect(row.id).toBe(SUPPLIER);
    expect(row.active).toBe(true);
  });

  it("updates only the provided fields", async () => {
    const { repo, models } = makeRepo();
    models.supplier.findFirst.mockResolvedValue(supplierRow({ name: "New name" }));
    const row = await repo.updateSupplier(ACTOR_CTX, SUPPLIER, { name: "New name" });
    expect(row?.name).toBe("New name");
    const args = models.supplier.updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(args.data).toMatchObject({ name: "New name" });
    expect(args.data).not.toHaveProperty("phone");
  });

  it("returns null when the supplier is not in this tenant", async () => {
    const { repo, models } = makeRepo();
    models.supplier.updateMany.mockResolvedValue({ count: 0 });
    expect(await repo.updateSupplier(ACTOR_CTX, "nope", { name: "x" })).toBeNull();
  });

  it("archives a supplier (soft-delete)", async () => {
    const { repo, models } = makeRepo();
    models.supplier.findFirst.mockResolvedValue(supplierRow({ isActive: false }));
    const row = await repo.archiveSupplier(ACTOR_CTX, SUPPLIER);
    expect(row?.active).toBe(false);
  });

  it("lists suppliers", async () => {
    const { repo, models } = makeRepo();
    models.supplier.findMany.mockResolvedValue([supplierRow()]);
    const page = await repo.listSuppliers(COMPANY, {
      sort: { field: "name", dir: "asc" },
      active: true,
    });
    expect(page.data).toHaveLength(1);
  });

  it("finds a supplier by id", async () => {
    const { repo, models } = makeRepo();
    models.supplier.findFirst.mockResolvedValue(supplierRow());
    expect(await repo.findSupplier(COMPANY, SUPPLIER)).not.toBeNull();
  });
});

describe("FinanceRepository — purchase order creation", () => {
  it("issues a PO number, resolves lines, and returns the detail view", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.supplier.findFirst.mockResolvedValue({ id: SUPPLIER });
    models.productVariant.findFirst.mockResolvedValue({ id: VARIANT });
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([{ next_number: 2n }]); // issuePoNumber
    models.purchaseOrder.create.mockResolvedValue({ id: PO });
    models.purchaseOrder.findFirstOrThrow.mockResolvedValue(poDetailRow());

    const result = await repo.createPurchaseOrder(ACTOR_CTX, {
      supplierId: SUPPLIER,
      lines: [{ variantId: VARIANT, quantityOrdered: 10, unitCost: 1000 }],
    });

    expect(result.replayed).toBe(false);
    expect(result.order.number).toBe(1);
    expect(result.order.lines).toHaveLength(1);
    expect(models.purchaseOrderLine.create).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty line list before opening a transaction", async () => {
    const { repo } = makeRepo();
    await expect(
      repo.createPurchaseOrder(ACTOR_CTX, { supplierId: SUPPLIER, lines: [] }),
    ).rejects.toBeInstanceOf(EmptyPurchaseOrderError);
  });

  it("rejects an unknown supplier", async () => {
    const { repo, models } = makeRepo();
    models.supplier.findFirst.mockResolvedValue(null);
    await expect(
      repo.createPurchaseOrder(ACTOR_CTX, {
        supplierId: SUPPLIER,
        lines: [{ variantId: VARIANT, quantityOrdered: 1, unitCost: 100 }],
      }),
    ).rejects.toBeInstanceOf(ReferenceNotFoundError);
  });

  it("finds a purchase order with its lines", async () => {
    const { repo, models } = makeRepo();
    models.purchaseOrder.findFirst.mockResolvedValue(poDetailRow());
    const row = await repo.findPurchaseOrder(COMPANY, PO);
    expect(row?.lines).toHaveLength(1);
  });

  it("lists purchase orders", async () => {
    const { repo, models } = makeRepo();
    models.purchaseOrder.findMany.mockResolvedValue([poDetailRow()]);
    const page = await repo.listPurchaseOrders(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
    });
    expect(page.data).toHaveLength(1);
  });
});

describe("FinanceRepository — atomic receipt (D7 moving average)", () => {
  it("raises on_hand, rolls averageCost, and advances status to partially_received", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([{ id: PO, status: "ordered" }]); // po lock
    queryRaw.mockResolvedValueOnce([
      {
        id: LINE1,
        variant_id: VARIANT,
        quantity_ordered: 10n,
        quantity_received: 0n,
        unit_cost: 1000n,
      },
    ]); // po lines lock
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    models.purchaseOrderReceipt.create.mockResolvedValue({ id: RECEIPT });
    queryRaw.mockResolvedValueOnce([{ id: VARIANT, average_cost: 500n }]); // variant lock
    queryRaw.mockResolvedValueOnce([{ id: "stock1", on_hand: 20n }]); // stock lock
    models.purchaseOrderLine.findMany.mockResolvedValue([
      { quantityOrdered: 10n, quantityReceived: 5n },
    ]);
    models.purchaseOrderReceipt.findFirstOrThrow.mockResolvedValue(receiptRow());
    models.purchaseOrder.findFirstOrThrow.mockResolvedValue(
      poDetailRow({ status: "partially_received" }),
    );

    const result = await repo.receivePurchaseOrder(ACTOR_CTX, PO, {
      warehouseId: WAREHOUSE,
      lines: [{ poLineId: LINE1, quantity: 5 }],
    });

    expect(result?.replayed).toBe(false);
    expect(result?.order.status).toBe("partially_received");

    // newAvg = floor((20*500 + 5*1000) / 25) = 600
    const variantPatch = models.productVariant.updateMany.mock.calls[0]?.[0] as {
      data: { averageCost: bigint };
    };
    expect(variantPatch.data.averageCost).toBe(600n);

    const stockPatch = models.inventoryStock.updateMany.mock.calls[0]?.[0] as {
      data: { onHand: { increment: bigint } };
    };
    expect(stockPatch.data.onHand.increment).toBe(5n);

    expect(models.stockAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reason: "purchase_receipt", quantityDelta: 5n }),
      }),
    );
  });

  it("advances status to received once every line is fully received", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([{ id: PO, status: "partially_received" }]);
    queryRaw.mockResolvedValueOnce([
      {
        id: LINE1,
        variant_id: VARIANT,
        quantity_ordered: 10n,
        quantity_received: 5n,
        unit_cost: 1000n,
      },
    ]);
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    models.purchaseOrderReceipt.create.mockResolvedValue({ id: RECEIPT });
    queryRaw.mockResolvedValueOnce([{ id: VARIANT, average_cost: 600n }]);
    queryRaw.mockResolvedValueOnce([{ id: "stock1", on_hand: 25n }]);
    models.purchaseOrderLine.findMany.mockResolvedValue([
      { quantityOrdered: 10n, quantityReceived: 10n },
    ]);
    models.purchaseOrderReceipt.findFirstOrThrow.mockResolvedValue(receiptRow());
    models.purchaseOrder.findFirstOrThrow.mockResolvedValue(poDetailRow({ status: "received" }));

    const result = await repo.receivePurchaseOrder(ACTOR_CTX, PO, {
      warehouseId: WAREHOUSE,
      lines: [{ poLineId: LINE1, quantity: 5 }],
    });

    expect(result?.order.status).toBe("received");
    const poPatch = models.purchaseOrder.updateMany.mock.calls[0]?.[0] as {
      data: { status: string };
    };
    expect(poPatch.data.status).toBe("received");
  });

  it("returns null when the purchase order is not in this tenant", async () => {
    const { repo, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // nothing locked
    const result = await repo.receivePurchaseOrder(ACTOR_CTX, "nope", {
      warehouseId: WAREHOUSE,
      lines: [{ poLineId: LINE1, quantity: 1 }],
    });
    expect(result).toBeNull();
  });
});

describe("FinanceRepository — payments", () => {
  it("records a payment", async () => {
    const { repo, models } = makeRepo();
    models.purchaseOrder.findFirst.mockResolvedValue({ id: PO });
    models.purchaseOrderPayment.create.mockResolvedValue(paymentRow());
    const result = await repo.payPurchaseOrder(ACTOR_CTX, PO, {
      amountMinor: 5000,
      method: "cash",
    });
    expect(result?.replayed).toBe(false);
    expect(result?.payment.amountMinor).toBe(5000);
  });

  it("returns null when the purchase order is not in this tenant", async () => {
    const { repo, models } = makeRepo();
    models.purchaseOrder.findFirst.mockResolvedValue(null);
    const result = await repo.payPurchaseOrder(ACTOR_CTX, "nope", {
      amountMinor: 100,
      method: "cash",
    });
    expect(result).toBeNull();
  });
});
