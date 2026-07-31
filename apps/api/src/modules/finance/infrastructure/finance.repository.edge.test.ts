/**
 * Edge-path coverage for the finance repository (EPIC-13, M13.2): idempotency
 * replays (create/receipt/payment), the racing-insert replay path, over-
 * receipt rejection, illegal PO state, and the moving-average formula's
 * defensive zero-denominator branch. Happy paths live in
 * `finance.repository.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@cadeau/database";
import {
  IllegalPurchaseOrderStateError,
  OverReceiptError,
  ReferenceNotFoundError,
} from "../domain/finance.errors";
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
    lines: [
      {
        id: LINE1,
        variantId: VARIANT,
        quantityOrdered: 10n,
        quantityReceived: 0n,
        unitCost: 1000n,
      },
    ],
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

function uniqueViolation(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "6",
    meta: { target },
  });
}

describe("FinanceRepository — cursor errors", () => {
  it("rejects a supplier cursor whose values are not strings", async () => {
    const { repo } = makeRepo();
    const { encodeCursor } = await import("@cadeau/database");
    await expect(
      repo.listSuppliers(COMPANY, {
        sort: { field: "name", dir: "asc" },
        active: true,
        cursor: encodeCursor({ p: 1, t: 2 }),
      }),
    ).rejects.toMatchObject({ name: "InvalidListCursorError" });
  });

  it("rejects an unparseable createdAt cursor for purchase orders", async () => {
    const { repo } = makeRepo();
    const { encodeCursor } = await import("@cadeau/database");
    await expect(
      repo.listPurchaseOrders(COMPANY, {
        sort: { field: "createdAt", dir: "desc" },
        cursor: encodeCursor({ p: "not-a-date", t: "id1" }),
      }),
    ).rejects.toMatchObject({ name: "InvalidListCursorError" });
  });
});

describe("FinanceRepository — purchase order idempotency", () => {
  it("replays a stored PO for a repeated key without issuing a new number", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.purchaseOrder.findFirst.mockResolvedValue(poDetailRow());
    const result = await repo.createPurchaseOrder(ACTOR_CTX, {
      supplierId: SUPPLIER,
      lines: [{ variantId: VARIANT, quantityOrdered: 10, unitCost: 1000 }],
      idempotencyKey: "k1",
    });
    expect(result.replayed).toBe(true);
    expect(result.order.id).toBe(PO);
    expect(queryRaw).not.toHaveBeenCalledWith(expect.stringContaining("purchase_order_sequences"));
  });

  it("replays a PO whose key lost the insert race", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.purchaseOrder.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(poDetailRow());
    models.supplier.findFirst.mockResolvedValue({ id: SUPPLIER });
    models.productVariant.findFirst.mockResolvedValue({ id: VARIANT });
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([{ next_number: 2n }]); // issuePoNumber
    models.purchaseOrder.create.mockRejectedValue(
      uniqueViolation("purchase_orders_idempotency_key"),
    );

    const result = await repo.createPurchaseOrder(ACTOR_CTX, {
      supplierId: SUPPLIER,
      lines: [{ variantId: VARIANT, quantityOrdered: 10, unitCost: 1000 }],
      idempotencyKey: "k1",
    });
    expect(result.replayed).toBe(true);
  });

  it("rethrows a create failure that is not a unique violation", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.supplier.findFirst.mockResolvedValue({ id: SUPPLIER });
    models.productVariant.findFirst.mockResolvedValue({ id: VARIANT });
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([{ next_number: 2n }]);
    models.purchaseOrder.create.mockRejectedValue(new Error("connection lost"));
    await expect(
      repo.createPurchaseOrder(ACTOR_CTX, {
        supplierId: SUPPLIER,
        lines: [{ variantId: VARIANT, quantityOrdered: 10, unitCost: 1000 }],
      }),
    ).rejects.toThrow("connection lost");
  });
});

describe("FinanceRepository — receipt idempotency and validation", () => {
  it("replays a stored receipt for a repeated key, moving no stock", async () => {
    const { repo, models } = makeRepo();
    models.purchaseOrderReceipt.findFirst.mockResolvedValue(receiptRow());
    models.purchaseOrder.findFirst.mockResolvedValue(poDetailRow({ status: "partially_received" }));
    const result = await repo.receivePurchaseOrder(ACTOR_CTX, PO, {
      warehouseId: WAREHOUSE,
      lines: [{ poLineId: LINE1, quantity: 5 }],
      idempotencyKey: "k1",
    });
    expect(result?.replayed).toBe(true);
    expect(models.inventoryStock.updateMany).not.toHaveBeenCalled();
    expect(models.stockAdjustment.create).not.toHaveBeenCalled();
  });

  it("returns null on replay when the order itself has vanished from this tenant", async () => {
    const { repo, models } = makeRepo();
    models.purchaseOrderReceipt.findFirst.mockResolvedValue(receiptRow());
    models.purchaseOrder.findFirst.mockResolvedValue(null);
    const result = await repo.receivePurchaseOrder(ACTOR_CTX, PO, {
      warehouseId: WAREHOUSE,
      lines: [{ poLineId: LINE1, quantity: 5 }],
      idempotencyKey: "k1",
    });
    expect(result).toBeNull();
  });

  it("replays a receipt whose key lost the insert race", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.purchaseOrderReceipt.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(receiptRow());
    models.purchaseOrder.findFirst.mockResolvedValue(poDetailRow({ status: "partially_received" }));
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
    models.purchaseOrderReceipt.create.mockRejectedValue(
      uniqueViolation("purchase_order_receipts_idempotency_key"),
    );

    const result = await repo.receivePurchaseOrder(ACTOR_CTX, PO, {
      warehouseId: WAREHOUSE,
      lines: [{ poLineId: LINE1, quantity: 5 }],
      idempotencyKey: "k1",
    });
    expect(result?.replayed).toBe(true);
  });

  it("rejects a receipt line exceeding the remaining quantity (over-receipt)", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([{ id: PO, status: "ordered" }]);
    queryRaw.mockResolvedValueOnce([
      {
        id: LINE1,
        variant_id: VARIANT,
        quantity_ordered: 10n,
        quantity_received: 8n,
        unit_cost: 1000n,
      },
    ]);
    await expect(
      repo.receivePurchaseOrder(ACTOR_CTX, PO, {
        warehouseId: WAREHOUSE,
        lines: [{ poLineId: LINE1, quantity: 5 }],
      }),
    ).rejects.toBeInstanceOf(OverReceiptError);
    expect(models.warehouse.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a receipt against a line that does not belong to this PO", async () => {
    const { repo, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([{ id: PO, status: "ordered" }]);
    queryRaw.mockResolvedValueOnce([]); // no lines locked
    await expect(
      repo.receivePurchaseOrder(ACTOR_CTX, PO, {
        warehouseId: WAREHOUSE,
        lines: [{ poLineId: "unknown-line", quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ReferenceNotFoundError);
  });

  it("rejects a receipt against an already-received purchase order", async () => {
    const { repo, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([{ id: PO, status: "received" }]);
    await expect(
      repo.receivePurchaseOrder(ACTOR_CTX, PO, {
        warehouseId: WAREHOUSE,
        lines: [{ poLineId: LINE1, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(IllegalPurchaseOrderStateError);
  });

  it("rejects a receipt against a cancelled purchase order", async () => {
    const { repo, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([{ id: PO, status: "cancelled" }]);
    await expect(
      repo.receivePurchaseOrder(ACTOR_CTX, PO, {
        warehouseId: WAREHOUSE,
        lines: [{ poLineId: LINE1, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(IllegalPurchaseOrderStateError);
  });

  it("leaves averageCost unchanged when the resulting on-hand would be zero (defensive)", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([{ id: PO, status: "ordered" }]);
    queryRaw.mockResolvedValueOnce([
      {
        id: LINE1,
        variant_id: VARIANT,
        quantity_ordered: 10n,
        quantity_received: 0n,
        unit_cost: 1000n,
      },
    ]);
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    models.purchaseOrderReceipt.create.mockResolvedValue({ id: RECEIPT });
    queryRaw.mockResolvedValueOnce([{ id: VARIANT, average_cost: 777n }]); // variant lock
    // Contrived: on_hand comes back as the negative of the received quantity,
    // so onHandBefore + quantity === 0 (unreachable in practice — DB CHECKs
    // keep on_hand >= 0 and quantity > 0 — but the branch must not divide by 0).
    queryRaw.mockResolvedValueOnce([{ id: "stock1", on_hand: -5n }]);
    models.purchaseOrderLine.findMany.mockResolvedValue([
      { quantityOrdered: 10n, quantityReceived: 5n },
    ]);
    models.purchaseOrderReceipt.findFirstOrThrow.mockResolvedValue(receiptRow());
    models.purchaseOrder.findFirstOrThrow.mockResolvedValue(
      poDetailRow({ status: "partially_received" }),
    );

    await repo.receivePurchaseOrder(ACTOR_CTX, PO, {
      warehouseId: WAREHOUSE,
      lines: [{ poLineId: LINE1, quantity: 5 }],
    });

    const variantPatch = models.productVariant.updateMany.mock.calls[0]?.[0] as {
      data: { averageCost: bigint };
    };
    expect(variantPatch.data.averageCost).toBe(777n);
  });
});

describe("FinanceRepository — payment idempotency", () => {
  it("replays a stored payment for a repeated key", async () => {
    const { repo, models } = makeRepo();
    models.purchaseOrderPayment.findFirst.mockResolvedValue(paymentRow());
    const result = await repo.payPurchaseOrder(ACTOR_CTX, PO, {
      amountMinor: 5000,
      method: "cash",
      idempotencyKey: "k1",
    });
    expect(result?.replayed).toBe(true);
    expect(models.purchaseOrderPayment.create).not.toHaveBeenCalled();
  });

  it("replays a payment whose key lost the insert race", async () => {
    const { repo, models } = makeRepo();
    models.purchaseOrderPayment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(paymentRow());
    models.purchaseOrder.findFirst.mockResolvedValue({ id: PO });
    models.purchaseOrderPayment.create.mockRejectedValue(
      uniqueViolation("purchase_order_payments_idempotency_key"),
    );
    const result = await repo.payPurchaseOrder(ACTOR_CTX, PO, {
      amountMinor: 5000,
      method: "cash",
      idempotencyKey: "k1",
    });
    expect(result?.replayed).toBe(true);
  });

  it("rethrows when the key raced but nothing was stored", async () => {
    const { repo, models } = makeRepo();
    models.purchaseOrder.findFirst.mockResolvedValue({ id: PO });
    models.purchaseOrderPayment.findFirst.mockResolvedValue(null);
    models.purchaseOrderPayment.create.mockRejectedValue(
      uniqueViolation("purchase_order_payments_idempotency_key"),
    );
    await expect(
      repo.payPurchaseOrder(ACTOR_CTX, PO, {
        amountMinor: 5000,
        method: "cash",
        idempotencyKey: "k1",
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
