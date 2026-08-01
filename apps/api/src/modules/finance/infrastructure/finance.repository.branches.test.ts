/**
 * Additional branch coverage for the finance repository (EPIC-13): list
 * filter combinations, not-found reads on find-by-id/update paths,
 * validation guards, and small internal helpers (`ensureStockLevel`,
 * `applyReceiptToStock`, `assertVariant`/`assertWarehouse`/`assertSupplier`
 * positive branches) not already exercised by `finance.repository.test.ts`
 * (happy paths) or `finance.repository.edge.test.ts` (idempotency/locking
 * edge cases).
 */
import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@cadeau/database";
import { ReferenceNotFoundError } from "../domain/finance.errors";
import { FinanceRepository } from "./finance.repository";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const SUPPLIER = "33333333-3333-3333-3333-333333333333";
const VARIANT = "55555555-5555-5555-5555-555555555555";
const WAREHOUSE = "66666666-6666-6666-6666-666666666666";
const PO = "77777777-7777-7777-7777-777777777777";
const LINE1 = "88888888-8888-8888-8888-888888888888";
const ACTOR_CTX = { companyId: COMPANY, actorId: ACTOR };
const NOW = new Date("2026-01-02T03:04:05.000Z");
const INVOICE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORDER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const RECONCILIATION = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const SHIPMENT = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

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

function expenseRow(extra: Record<string, unknown> = {}) {
  return {
    id: "exp1",
    category: "office_supplies",
    amountMinor: 12500n,
    incurredAt: NOW,
    notes: null,
    supplierId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

function invoiceDetailRow(extra: Record<string, unknown> = {}) {
  return {
    id: INVOICE,
    number: 1n,
    orderId: null,
    subtotalMinor: 10000n,
    vatMinor: 1400n,
    totalMinor: 11400n,
    vatRateBpsSnapshot: 1400,
    pdfGeneratedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    lines: [
      {
        id: "il1",
        description: "Widget",
        quantity: 1n,
        unitPriceMinor: 10000n,
        lineTotalMinor: 10000n,
      },
    ],
    ...extra,
  };
}

function reconciliationDetailRow(extra: Record<string, unknown> = {}) {
  return {
    id: RECONCILIATION,
    carrier: "manual",
    statementRef: "STMT-2026-01",
    periodKey: "2026-01",
    totalStatementMinor: 5000n,
    totalFeeMinor: 4800n,
    totalVarianceMinor: 200n,
    createdAt: NOW,
    updatedAt: NOW,
    lines: [
      {
        id: "rl1",
        shipmentId: SHIPMENT,
        statementAmountMinor: 5000n,
        shipmentFeeMinor: 4800n,
        varianceMinor: 200n,
      },
    ],
    ...extra,
  };
}

function delegate() {
  return {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findFirstOrThrow: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn().mockResolvedValue({ id: "stock1" }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    aggregate: vi.fn().mockResolvedValue({ _sum: {} }),
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
    expense: delegate(),
    taxSettings: delegate(),
    invoice: delegate(),
    invoiceLine: delegate(),
    refund: delegate(),
    order: delegate(),
    orderItem: delegate(),
    company: delegate(),
    shipment: delegate(),
    shippingReconciliation: delegate(),
    shippingReconciliationLine: delegate(),
    accountingPeriod: delegate(),
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

describe("FinanceRepository — supplier filters and not-found branches", () => {
  it("lists suppliers with active=all and no isActive filter applied", async () => {
    const { repo, models } = makeRepo();
    models.supplier.findMany.mockResolvedValue([supplierRow()]);
    await repo.listSuppliers(COMPANY, { sort: { field: "createdAt", dir: "desc" }, active: "all" });
    const args = models.supplier.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where).not.toHaveProperty("isActive");
  });

  it("lists suppliers with a search term (OR across name/email/phone)", async () => {
    const { repo, models } = makeRepo();
    models.supplier.findMany.mockResolvedValue([]);
    await repo.listSuppliers(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
      active: true,
      q: "acme",
    });
    const args = models.supplier.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where["OR"]).toBeDefined();
  });

  it("lists suppliers sorted by createdAt, encoding a createdAt-keyed nextCursor when a page overflows", async () => {
    const { repo, models } = makeRepo();
    // Two rows against limit=1 forces buildKeysetPage's `hasMore` branch,
    // which is what actually invokes the `toCursor` callback below.
    models.supplier.findMany.mockResolvedValue([
      supplierRow({ id: "s1" }),
      supplierRow({ id: "s2" }),
    ]);
    const page = await repo.listSuppliers(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
      active: true,
      limit: 1,
    });
    expect(page.data).toHaveLength(1);
    expect(page.page.hasMore).toBe(true);
    expect(page.page.nextCursor).not.toBeNull();
  });

  it("lists suppliers sorted by name, encoding a name-keyed nextCursor when a page overflows", async () => {
    const { repo, models } = makeRepo();
    models.supplier.findMany.mockResolvedValue([
      supplierRow({ id: "s1", name: "A" }),
      supplierRow({ id: "s2", name: "B" }),
    ]);
    const page = await repo.listSuppliers(COMPANY, {
      sort: { field: "name", dir: "asc" },
      active: true,
      limit: 1,
    });
    expect(page.page.nextCursor).not.toBeNull();
  });

  it("lists suppliers with a valid cursor, applying the keyset predicate", async () => {
    const { repo, models } = makeRepo();
    models.supplier.findMany.mockResolvedValue([supplierRow()]);
    const { encodeCursor } = await import("@cadeau/database");
    await repo.listSuppliers(COMPANY, {
      sort: { field: "name", dir: "asc" },
      active: true,
      cursor: encodeCursor({ p: "Acme", t: SUPPLIER }),
    });
    const args = models.supplier.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where["AND"]).toBeDefined();
  });

  it("returns null when a supplier is not found", async () => {
    const { repo, models } = makeRepo();
    models.supplier.findFirst.mockResolvedValue(null);
    expect(await repo.findSupplier(COMPANY, "nope")).toBeNull();
  });

  it("updates every mutable field at once", async () => {
    const { repo, models } = makeRepo();
    models.supplier.findFirst.mockResolvedValue(supplierRow({ name: "New name" }));
    await repo.updateSupplier(ACTOR_CTX, SUPPLIER, {
      name: "New name",
      phone: "555",
      email: "a@b.com",
      address: "1 Main St",
      taxId: "TAX1",
      active: false,
    });
    const args = models.supplier.updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(args.data).toMatchObject({
      name: "New name",
      phone: "555",
      email: "a@b.com",
      address: "1 Main St",
      taxId: "TAX1",
      isActive: false,
    });
  });

  it("updates only active, leaving name untouched", async () => {
    const { repo, models } = makeRepo();
    models.supplier.findFirst.mockResolvedValue(supplierRow({ isActive: false }));
    await repo.updateSupplier(ACTOR_CTX, SUPPLIER, { active: false });
    const args = models.supplier.updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(args.data).not.toHaveProperty("name");
    expect(args.data).toMatchObject({ isActive: false });
  });

  it("returns null when updateSupplier's re-read comes back empty (defensive)", async () => {
    const { repo, models } = makeRepo();
    models.supplier.findFirst.mockResolvedValue(null);
    expect(await repo.updateSupplier(ACTOR_CTX, SUPPLIER, { name: "x" })).toBeNull();
  });

  it("returns null when archiveSupplier matches no row", async () => {
    const { repo, models } = makeRepo();
    models.supplier.updateMany.mockResolvedValue({ count: 0 });
    expect(await repo.archiveSupplier(ACTOR_CTX, "nope")).toBeNull();
  });

  it("returns null when archiveSupplier's re-read comes back empty (defensive)", async () => {
    const { repo, models } = makeRepo();
    models.supplier.findFirst.mockResolvedValue(null);
    expect(await repo.archiveSupplier(ACTOR_CTX, SUPPLIER)).toBeNull();
  });
});

describe("FinanceRepository — purchase order filters and not-found branches", () => {
  it("filters by status, supplierId, and a date range, with a cursor", async () => {
    const { repo, models } = makeRepo();
    models.purchaseOrder.findMany.mockResolvedValue([]);
    const { encodeCursor } = await import("@cadeau/database");
    await repo.listPurchaseOrders(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
      status: "ordered",
      supplierId: SUPPLIER,
      dateFrom: "2026-01-01T00:00:00.000Z",
      dateTo: "2026-01-31T00:00:00.000Z",
      cursor: encodeCursor({ p: "2026-01-15T00:00:00.000Z", t: "id1" }),
    });
    const args = models.purchaseOrder.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({ status: "ordered", supplierId: SUPPLIER });
    expect(args.where["createdAt"]).toBeDefined();
    expect(args.where["AND"]).toBeDefined();
  });

  it("filters by dateFrom only and dateTo only (each independently)", async () => {
    const { repo, models } = makeRepo();
    models.purchaseOrder.findMany.mockResolvedValue([]);
    await repo.listPurchaseOrders(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
      dateFrom: "2026-01-01T00:00:00.000Z",
    });
    let args = models.purchaseOrder.findMany.mock.calls[0]?.[0] as {
      where: { createdAt: Record<string, unknown> };
    };
    expect(args.where.createdAt).toHaveProperty("gte");
    expect(args.where.createdAt).not.toHaveProperty("lte");

    await repo.listPurchaseOrders(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
      dateTo: "2026-01-31T00:00:00.000Z",
    });
    args = models.purchaseOrder.findMany.mock.calls[1]?.[0] as {
      where: { createdAt: Record<string, unknown> };
    };
    expect(args.where.createdAt).toHaveProperty("lte");
    expect(args.where.createdAt).not.toHaveProperty("gte");
  });

  it("returns null when a purchase order is not found", async () => {
    const { repo, models } = makeRepo();
    models.purchaseOrder.findFirst.mockResolvedValue(null);
    expect(await repo.findPurchaseOrder(COMPANY, "nope")).toBeNull();
  });

  it("rejects a non-positive quantityOrdered", async () => {
    const { repo, models } = makeRepo();
    models.supplier.findFirst.mockResolvedValue({ id: SUPPLIER });
    await expect(
      repo.createPurchaseOrder(ACTOR_CTX, {
        supplierId: SUPPLIER,
        lines: [{ variantId: VARIANT, quantityOrdered: 0, unitCost: 1000 }],
      }),
    ).rejects.toMatchObject({ name: "InvalidAmountError", field: "quantityOrdered" });
  });

  it("rejects a negative unitCost", async () => {
    const { repo, models } = makeRepo();
    models.supplier.findFirst.mockResolvedValue({ id: SUPPLIER });
    await expect(
      repo.createPurchaseOrder(ACTOR_CTX, {
        supplierId: SUPPLIER,
        lines: [{ variantId: VARIANT, quantityOrdered: 1, unitCost: -1 }],
      }),
    ).rejects.toMatchObject({ name: "InvalidAmountError", field: "unitCost" });
  });

  it("stores a provided expectedDate", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.supplier.findFirst.mockResolvedValue({ id: SUPPLIER });
    models.productVariant.findFirst.mockResolvedValue({ id: VARIANT });
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([{ next_number: 2n }]); // issuePoNumber
    models.purchaseOrder.create.mockResolvedValue({ id: PO });
    models.purchaseOrder.findFirstOrThrow.mockResolvedValue(poDetailRow());

    await repo.createPurchaseOrder(ACTOR_CTX, {
      supplierId: SUPPLIER,
      expectedDate: "2026-02-01T00:00:00.000Z",
      lines: [{ variantId: VARIANT, quantityOrdered: 10, unitCost: 1000 }],
    });

    const createArgs = models.purchaseOrder.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(createArgs.data["expectedDate"]).toBeInstanceOf(Date);
  });
});

describe("FinanceRepository — receipt validation branches", () => {
  it("rejects an empty receipt line list", async () => {
    const { repo } = makeRepo();
    await expect(
      repo.receivePurchaseOrder(ACTOR_CTX, PO, { warehouseId: WAREHOUSE, lines: [] }),
    ).rejects.toMatchObject({ name: "EmptyPurchaseOrderError" });
  });

  it("rejects a non-positive receipt line quantity", async () => {
    const { repo, queryRaw } = makeRepo();
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
    await expect(
      repo.receivePurchaseOrder(ACTOR_CTX, PO, {
        warehouseId: WAREHOUSE,
        lines: [{ poLineId: LINE1, quantity: 0 }],
      }),
    ).rejects.toMatchObject({ name: "InvalidAmountError", field: "quantity" });
  });

  it("stores a provided receivedAt", async () => {
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
    models.purchaseOrderReceipt.create.mockResolvedValue({ id: "receipt1" });
    queryRaw.mockResolvedValueOnce([{ id: VARIANT, average_cost: 500n }]);
    queryRaw.mockResolvedValueOnce([{ id: "stock1", on_hand: 20n }]);
    models.purchaseOrderLine.findMany.mockResolvedValue([
      { quantityOrdered: 10n, quantityReceived: 5n },
    ]);
    models.purchaseOrderReceipt.findFirstOrThrow.mockResolvedValue({
      id: "receipt1",
      poId: PO,
      warehouseId: WAREHOUSE,
      receivedAt: NOW,
      lines: [],
    });
    models.purchaseOrder.findFirstOrThrow.mockResolvedValue(
      poDetailRow({ status: "partially_received" }),
    );

    await repo.receivePurchaseOrder(ACTOR_CTX, PO, {
      warehouseId: WAREHOUSE,
      receivedAt: "2026-01-05T00:00:00.000Z",
      lines: [{ poLineId: LINE1, quantity: 5 }],
    });

    const createArgs = models.purchaseOrderReceipt.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect((createArgs.data["receivedAt"] as Date).toISOString()).toBe("2026-01-05T00:00:00.000Z");
  });

  it("returns null when a raced receipt replay's order has vanished from this tenant", async () => {
    const { repo, models, queryRaw } = makeRepo();
    // No replay on the initial idempotency-key check: the race is only
    // discovered when the insert itself collides below.
    models.purchaseOrderReceipt.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "receipt1",
      poId: PO,
      warehouseId: WAREHOUSE,
      receivedAt: NOW,
      lines: [],
    });
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
    models.purchaseOrderReceipt.create.mockRejectedValue(
      uniqueViolation("purchase_order_receipts_idempotency_key"),
    );
    models.purchaseOrder.findFirst.mockResolvedValue(null);

    const result = await repo.receivePurchaseOrder(ACTOR_CTX, PO, {
      warehouseId: WAREHOUSE,
      lines: [{ poLineId: LINE1, quantity: 5 }],
      idempotencyKey: "k1",
    });
    expect(result).toBeNull();
  });
});

describe("FinanceRepository — payment validation branches", () => {
  it("rejects a non-positive payment amount", async () => {
    const { repo } = makeRepo();
    await expect(
      repo.payPurchaseOrder(ACTOR_CTX, PO, { amountMinor: 0, method: "cash" }),
    ).rejects.toMatchObject({ name: "InvalidAmountError", field: "amountMinor" });
  });

  it("stores a provided paidAt", async () => {
    const { repo, models } = makeRepo();
    models.purchaseOrder.findFirst.mockResolvedValue({ id: PO });
    models.purchaseOrderPayment.create.mockResolvedValue({
      id: "pay1",
      poId: PO,
      amountMinor: 5000n,
      method: "cash",
      paidAt: new Date("2026-01-05T00:00:00.000Z"),
    });
    await repo.payPurchaseOrder(ACTOR_CTX, PO, {
      amountMinor: 5000,
      method: "cash",
      paidAt: "2026-01-05T00:00:00.000Z",
    });
    const createArgs = models.purchaseOrderPayment.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect((createArgs.data["paidAt"] as Date).toISOString()).toBe("2026-01-05T00:00:00.000Z");
  });
});

describe("FinanceRepository — expense filters and update branches", () => {
  it("filters expenses by dateFrom only, dateTo only, and with a cursor", async () => {
    const { repo, models } = makeRepo();
    models.expense.findMany.mockResolvedValue([]);
    await repo.listExpenses(COMPANY, {
      sort: { field: "incurredAt", dir: "desc" },
      dateFrom: "2026-01-01T00:00:00.000Z",
    });
    let args = models.expense.findMany.mock.calls[0]?.[0] as {
      where: { incurredAt: Record<string, unknown> };
    };
    expect(args.where.incurredAt).toHaveProperty("gte");

    const { encodeCursor } = await import("@cadeau/database");
    await repo.listExpenses(COMPANY, {
      sort: { field: "incurredAt", dir: "desc" },
      dateTo: "2026-01-31T00:00:00.000Z",
      cursor: encodeCursor({ p: "2026-01-15T00:00:00.000Z", t: "id1" }),
    });
    args = models.expense.findMany.mock.calls[1]?.[0] as {
      where: { incurredAt: Record<string, unknown> };
    };
    expect(args.where.incurredAt).toHaveProperty("lte");
  });

  it("returns null when an expense is not found", async () => {
    const { repo, models } = makeRepo();
    models.expense.findFirst.mockResolvedValue(null);
    expect(await repo.findExpense(COMPANY, "nope")).toBeNull();
  });

  it("rejects updateExpense with a non-positive amountMinor", async () => {
    const { repo } = makeRepo();
    await expect(repo.updateExpense(ACTOR_CTX, "exp1", { amountMinor: 0 })).rejects.toMatchObject({
      name: "InvalidAmountError",
    });
  });

  it("updates notes, supplierId (validated), and incurredAt (period-checked) together", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    models.expense.findFirst
      .mockResolvedValueOnce(expenseRow())
      .mockResolvedValueOnce(expenseRow({ notes: "updated" }));
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen (existing date)
    models.supplier.findFirst.mockResolvedValue({ id: SUPPLIER });
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen (new incurredAt)

    await repo.updateExpense(ACTOR_CTX, "exp1", {
      notes: "updated",
      supplierId: SUPPLIER,
      incurredAt: "2026-02-01T00:00:00.000Z",
    });
    const args = models.expense.updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(args.data).toMatchObject({ notes: "updated", supplierId: SUPPLIER });
    expect(args.data["incurredAt"]).toBeInstanceOf(Date);
  });

  it("clears supplierId when explicitly set to null (no assertSupplier call)", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    models.expense.findFirst
      .mockResolvedValueOnce(expenseRow({ supplierId: SUPPLIER }))
      .mockResolvedValueOnce(expenseRow({ supplierId: null }));
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen

    await repo.updateExpense(ACTOR_CTX, "exp1", { supplierId: null });
    expect(models.supplier.findFirst).not.toHaveBeenCalled();
    const args = models.expense.updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(args.data).toMatchObject({ supplierId: null });
  });

  it("returns null when updateExpense matches no row", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    models.expense.findFirst.mockResolvedValue(expenseRow());
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    models.expense.updateMany.mockResolvedValue({ count: 0 });
    expect(await repo.updateExpense(ACTOR_CTX, "exp1", { category: "travel" })).toBeNull();
  });

  it("returns null when updateExpense's re-read comes back empty (defensive)", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    models.expense.findFirst.mockResolvedValueOnce(expenseRow()).mockResolvedValueOnce(null);
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    expect(await repo.updateExpense(ACTOR_CTX, "exp1", { category: "travel" })).toBeNull();
  });
});

describe("FinanceRepository — tax settings default fallbacks", () => {
  it("creates the row with zero-rate/null-registration defaults when neither is provided", async () => {
    const { repo, models } = makeRepo();
    models.taxSettings.upsert.mockResolvedValue({
      companyId: COMPANY,
      vatRateBps: 0,
      vatRegistrationNumber: null,
      updatedAt: NOW,
    });
    await repo.updateTaxSettings(ACTOR_CTX, {});
    const args = models.taxSettings.upsert.mock.calls[0]?.[0] as {
      create: Record<string, unknown>;
    };
    expect(args.create).toMatchObject({ vatRateBps: 0, vatRegistrationNumber: null });
  });
});

describe("FinanceRepository — invoice filters and not-found branches", () => {
  it("filters invoices by orderId, dateFrom only, and dateTo only", async () => {
    const { repo, models } = makeRepo();
    models.invoice.findMany.mockResolvedValue([]);
    await repo.listInvoices(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
      orderId: ORDER,
      dateFrom: "2026-01-01T00:00:00.000Z",
    });
    let args = models.invoice.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown> & { createdAt: Record<string, unknown> };
    };
    expect(args.where["orderId"]).toBe(ORDER);
    expect(args.where.createdAt).toHaveProperty("gte");

    await repo.listInvoices(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
      dateTo: "2026-01-31T00:00:00.000Z",
    });
    args = models.invoice.findMany.mock.calls[1]?.[0] as {
      where: Record<string, unknown> & { createdAt: Record<string, unknown> };
    };
    expect(args.where.createdAt).toHaveProperty("lte");
  });

  it("lists invoices with a cursor", async () => {
    const { repo, models } = makeRepo();
    models.invoice.findMany.mockResolvedValue([]);
    const { encodeCursor } = await import("@cadeau/database");
    await repo.listInvoices(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
      cursor: encodeCursor({ p: "2026-01-15T00:00:00.000Z", t: "id1" }),
    });
    const args = models.invoice.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where["AND"]).toBeDefined();
  });

  it("returns null when an invoice is not found", async () => {
    const { repo, models } = makeRepo();
    models.invoice.findFirst.mockResolvedValue(null);
    expect(await repo.findInvoice(COMPANY, "nope")).toBeNull();
  });

  it("rejects a manual invoice line with non-positive quantity", async () => {
    const { repo, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    await expect(
      repo.createInvoice(ACTOR_CTX, {
        lines: [{ description: "Widget", quantity: 0, unitPriceMinor: 100 }],
      }),
    ).rejects.toMatchObject({ name: "InvalidAmountError", field: "quantity" });
  });

  it("rejects a manual invoice line with a negative unitPriceMinor", async () => {
    const { repo, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    await expect(
      repo.createInvoice(ACTOR_CTX, {
        lines: [{ description: "Widget", quantity: 1, unitPriceMinor: -1 }],
      }),
    ).rejects.toMatchObject({ name: "InvalidAmountError", field: "unitPriceMinor" });
  });

  it("gathers PDF data with no linked order, missing company, and missing tax settings", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    models.invoice.findFirst.mockResolvedValueOnce(
      invoiceDetailRow({ orderId: null, pdfGeneratedAt: NOW }),
    );
    models.company.findFirst.mockResolvedValue(null);
    models.taxSettings.findFirst.mockResolvedValue(null);

    const data = await repo.getInvoicePdfData(COMPANY, INVOICE);
    expect(data?.companyName).toBeNull();
    expect(data?.vatRegistrationNumber).toBeNull();
    expect(data?.billToName).toBeNull();
    expect(models.order.findFirst).not.toHaveBeenCalled();
  });

  it("gathers PDF data for an order whose customer lookup comes back empty (defensive)", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    models.invoice.findFirst.mockResolvedValueOnce(
      invoiceDetailRow({ orderId: ORDER, pdfGeneratedAt: NOW }),
    );
    models.company.findFirst.mockResolvedValue({ name: "Acme" });
    models.taxSettings.findFirst.mockResolvedValue({ vatRegistrationNumber: "VAT-1" });
    models.order.findFirst.mockResolvedValue(null);

    const data = await repo.getInvoicePdfData(COMPANY, INVOICE);
    expect(data?.billToName).toBeNull();
  });
});

describe("FinanceRepository — refund filters", () => {
  it("filters refunds by invoiceId, orderId, and a date range, with a cursor", async () => {
    const { repo, models } = makeRepo();
    models.refund.findMany.mockResolvedValue([]);
    const { encodeCursor } = await import("@cadeau/database");
    await repo.listRefunds(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
      invoiceId: INVOICE,
      orderId: ORDER,
      dateFrom: "2026-01-01T00:00:00.000Z",
      dateTo: "2026-01-31T00:00:00.000Z",
      cursor: encodeCursor({ p: "2026-01-15T00:00:00.000Z", t: "id1" }),
    });
    const args = models.refund.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ invoiceId: INVOICE, orderId: ORDER });
    expect(args.where["createdAt"]).toBeDefined();
    expect(args.where["AND"]).toBeDefined();
  });

  it("filters refunds by dateFrom only and dateTo only", async () => {
    const { repo, models } = makeRepo();
    models.refund.findMany.mockResolvedValue([]);
    await repo.listRefunds(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
      dateFrom: "2026-01-01T00:00:00.000Z",
    });
    let args = models.refund.findMany.mock.calls[0]?.[0] as {
      where: { createdAt: Record<string, unknown> };
    };
    expect(args.where.createdAt).toHaveProperty("gte");

    await repo.listRefunds(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
      dateTo: "2026-01-31T00:00:00.000Z",
    });
    args = models.refund.findMany.mock.calls[1]?.[0] as {
      where: { createdAt: Record<string, unknown> };
    };
    expect(args.where.createdAt).toHaveProperty("lte");
  });
});

describe("FinanceRepository — reconciliation filters, not-found, and raced replay", () => {
  it("filters reconciliations by carrier, periodKey, and a cursor", async () => {
    const { repo, models } = makeRepo();
    models.shippingReconciliation.findMany.mockResolvedValue([]);
    const { encodeCursor } = await import("@cadeau/database");
    await repo.listReconciliations(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
      carrier: "manual",
      periodKey: "2026-01",
      cursor: encodeCursor({ p: "2026-01-15T00:00:00.000Z", t: "id1" }),
    });
    const args = models.shippingReconciliation.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({ carrier: "manual", periodKey: "2026-01" });
    expect(args.where["AND"]).toBeDefined();
  });

  it("returns null when a reconciliation is not found", async () => {
    const { repo, models } = makeRepo();
    models.shippingReconciliation.findFirst.mockResolvedValue(null);
    expect(await repo.findReconciliation(COMPANY, "nope")).toBeNull();
  });

  it("replays a reconciliation whose key lost the insert race", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    models.shipment.findFirst.mockResolvedValue({ id: SHIPMENT, fee: 4800n });
    models.shippingReconciliation.create.mockRejectedValue(
      uniqueViolation("shipping_reconciliations_idempotency_key"),
    );
    models.shippingReconciliation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(reconciliationDetailRow());

    const result = await repo.createReconciliation(ACTOR_CTX, {
      carrier: "manual",
      statementRef: "STMT-2026-01",
      periodKey: "2026-01",
      lines: [{ trackingNumber: "TRK1", statementAmountMinor: 5000 }],
      idempotencyKey: "k1",
    });
    expect(result.replayed).toBe(true);
  });

  it("rethrows a reconciliation create failure that is not a unique violation", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    models.shipment.findFirst.mockResolvedValue({ id: SHIPMENT, fee: 4800n });
    models.shippingReconciliation.create.mockRejectedValue(new Error("connection lost"));
    await expect(
      repo.createReconciliation(ACTOR_CTX, {
        carrier: "manual",
        statementRef: "STMT-2026-01",
        periodKey: "2026-01",
        lines: [{ trackingNumber: "TRK1", statementAmountMinor: 5000 }],
      }),
    ).rejects.toThrow("connection lost");
  });
});

describe("FinanceRepository — P&L report null-sum defaults", () => {
  it("treats missing revenue/expense sums as zero", async () => {
    const { repo, models } = makeRepo();
    models.invoice.aggregate.mockResolvedValue({ _sum: { subtotalMinor: null } });
    models.orderItem.findMany.mockResolvedValue([]);
    models.expense.aggregate.mockResolvedValue({ _sum: { amountMinor: null } });

    const report = await repo.getPnlReport(
      COMPANY,
      "2026-01-01T00:00:00.000Z",
      "2026-01-31T23:59:59.000Z",
    );
    expect(report.current).toEqual({
      revenueMinor: 0,
      cogsMinor: 0,
      expensesMinor: 0,
      netIncomeMinor: 0,
    });
  });
});

describe("FinanceRepository — receipt stock internals", () => {
  function setupReceiptThroughVariantLock(models: ReturnType<typeof makeRepo>["models"]) {
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    models.purchaseOrderReceipt.create.mockResolvedValue({ id: "receipt1" });
  }

  it("rejects a receipt when the variant row is not locked (vanished mid-flight)", async () => {
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
    setupReceiptThroughVariantLock(models);
    queryRaw.mockResolvedValueOnce([]); // variant lock: nothing found

    await expect(
      repo.receivePurchaseOrder(ACTOR_CTX, PO, {
        warehouseId: WAREHOUSE,
        lines: [{ poLineId: LINE1, quantity: 5 }],
      }),
    ).rejects.toBeInstanceOf(ReferenceNotFoundError);
  });

  it("swallows a P2002 from a racing stock-level upsert and proceeds to lock the row", async () => {
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
    setupReceiptThroughVariantLock(models);
    queryRaw.mockResolvedValueOnce([{ id: VARIANT, average_cost: 500n }]); // variant lock
    models.inventoryStock.upsert.mockRejectedValue(uniqueViolation("inventory_stock_unique"));
    queryRaw.mockResolvedValueOnce([{ id: "stock1", on_hand: 20n }]); // stock lock (after swallow)
    models.purchaseOrderLine.findMany.mockResolvedValue([
      { quantityOrdered: 10n, quantityReceived: 5n },
    ]);
    models.purchaseOrderReceipt.findFirstOrThrow.mockResolvedValue({
      id: "receipt1",
      poId: PO,
      warehouseId: WAREHOUSE,
      receivedAt: NOW,
      lines: [],
    });
    models.purchaseOrder.findFirstOrThrow.mockResolvedValue(
      poDetailRow({ status: "partially_received" }),
    );

    const result = await repo.receivePurchaseOrder(ACTOR_CTX, PO, {
      warehouseId: WAREHOUSE,
      lines: [{ poLineId: LINE1, quantity: 5 }],
    });
    expect(result?.replayed).toBe(false);
  });

  it("rethrows a non-P2002 error from the stock-level upsert", async () => {
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
    setupReceiptThroughVariantLock(models);
    queryRaw.mockResolvedValueOnce([{ id: VARIANT, average_cost: 500n }]); // variant lock
    models.inventoryStock.upsert.mockRejectedValue(new Error("connection lost"));

    await expect(
      repo.receivePurchaseOrder(ACTOR_CTX, PO, {
        warehouseId: WAREHOUSE,
        lines: [{ poLineId: LINE1, quantity: 5 }],
      }),
    ).rejects.toThrow("connection lost");
  });

  it("rejects a receipt when the stock level row is not locked after the upsert (defensive)", async () => {
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
    setupReceiptThroughVariantLock(models);
    queryRaw.mockResolvedValueOnce([{ id: VARIANT, average_cost: 500n }]); // variant lock
    queryRaw.mockResolvedValueOnce([]); // stock lock: nothing found

    await expect(
      repo.receivePurchaseOrder(ACTOR_CTX, PO, {
        warehouseId: WAREHOUSE,
        lines: [{ poLineId: LINE1, quantity: 5 }],
      }),
    ).rejects.toBeInstanceOf(ReferenceNotFoundError);
  });
});

describe("FinanceRepository — reference-assertion positive branches", () => {
  it("accepts a create-expense supplierId that resolves to an active supplier", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    models.supplier.findFirst.mockResolvedValue({ id: SUPPLIER });
    models.expense.create.mockResolvedValue(expenseRow({ supplierId: SUPPLIER }));

    const result = await repo.createExpense(ACTOR_CTX, {
      category: "office_supplies",
      amountMinor: 100,
      incurredAt: "2026-01-02T00:00:00.000Z",
      supplierId: SUPPLIER,
    });
    expect(result.expense.supplierId).toBe(SUPPLIER);
  });

  it("resolves order-based invoice lines when the referenced order exists", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    models.order.findFirst.mockResolvedValue({
      id: ORDER,
      items: [{ nameSnapshot: "Widget", quantity: 1n, price: 100n }],
    });
    models.taxSettings.upsert.mockResolvedValue({ vatRateBps: 0 });
    queryRaw.mockResolvedValueOnce([{ next_number: 2n }]);
    models.invoice.create.mockResolvedValue({ id: INVOICE });
    models.invoiceLine.create.mockResolvedValue({});
    models.invoice.findFirstOrThrow.mockResolvedValue(invoiceDetailRow({ orderId: ORDER }));

    const result = await repo.createInvoice(ACTOR_CTX, { orderId: ORDER });
    expect(result.invoice.orderId).toBe(ORDER);
  });
});

describe("FinanceRepository — remaining assertion/idempotency/keyset branches", () => {
  it("rejects updateExpense's amountMinor field when actually applied to the patch", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    models.expense.findFirst
      .mockResolvedValueOnce(expenseRow())
      .mockResolvedValueOnce(expenseRow({ amountMinor: 99900n }));
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    await repo.updateExpense(ACTOR_CTX, "exp1", { amountMinor: 99900 });
    const args = models.expense.updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(args.data).toMatchObject({ amountMinor: 99900n });
  });

  it("rejects an invoice with neither orderId nor lines at the repository layer (defensive)", async () => {
    const { repo, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    await expect(repo.createInvoice(ACTOR_CTX, {})).rejects.toMatchObject({
      name: "EmptyInvoiceError",
    });
  });

  it("rejects createPurchaseOrder for an unknown variant", async () => {
    const { repo, models } = makeRepo();
    models.supplier.findFirst.mockResolvedValue({ id: SUPPLIER });
    models.productVariant.findFirst.mockResolvedValue(null);
    await expect(
      repo.createPurchaseOrder(ACTOR_CTX, {
        supplierId: SUPPLIER,
        lines: [{ variantId: "unknown-variant", quantityOrdered: 1, unitCost: 100 }],
      }),
    ).rejects.toMatchObject({ name: "ReferenceNotFoundError", field: "variantId" });
  });

  it("rejects receivePurchaseOrder for an unknown warehouse", async () => {
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
    models.warehouse.findFirst.mockResolvedValue(null);
    await expect(
      repo.receivePurchaseOrder(ACTOR_CTX, PO, {
        warehouseId: "unknown-warehouse",
        lines: [{ poLineId: LINE1, quantity: 5 }],
      }),
    ).rejects.toMatchObject({ name: "ReferenceNotFoundError", field: "warehouseId" });
  });

  it("rejects createRefund for an unknown orderId", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    models.order.findFirst.mockResolvedValue(null);
    await expect(
      repo.createRefund(ACTOR_CTX, {
        orderId: "unknown-order",
        amountMinor: 100,
        reason: "x",
        idempotencyKey: "k1",
      }),
    ).rejects.toMatchObject({ name: "ReferenceNotFoundError", field: "orderId" });
  });

  it("treats a missing refund idempotency key as no replay (defensive; the port type requires one)", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    models.invoice.findFirst.mockResolvedValue({ id: INVOICE });
    models.refund.create.mockResolvedValue({
      id: "ref1",
      invoiceId: INVOICE,
      orderId: null,
      amountMinor: 5000n,
      reason: "x",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await repo.createRefund(ACTOR_CTX, {
      invoiceId: INVOICE,
      amountMinor: 5000,
      reason: "x",
      idempotencyKey: undefined as unknown as string,
    });
    expect(models.refund.findFirst).not.toHaveBeenCalled();
  });

  it("rethrows the original P2002 when its unique-violation target does not mention idempotency", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.supplier.findFirst.mockResolvedValue({ id: SUPPLIER });
    models.productVariant.findFirst.mockResolvedValue({ id: VARIANT });
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([{ next_number: 2n }]); // issuePoNumber
    const raced = uniqueViolation("purchase_orders_number_key");
    models.purchaseOrder.create.mockRejectedValue(raced);
    await expect(
      repo.createPurchaseOrder(ACTOR_CTX, {
        supplierId: SUPPLIER,
        lines: [{ variantId: VARIANT, quantityOrdered: 1, unitCost: 100 }],
        idempotencyKey: "k1",
      }),
    ).rejects.toBe(raced);
  });

  it('treats a P2002 with no meta.target as not an idempotency race (`?? ""` fallback)', async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.supplier.findFirst.mockResolvedValue({ id: SUPPLIER });
    models.productVariant.findFirst.mockResolvedValue({ id: VARIANT });
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([{ next_number: 2n }]); // issuePoNumber
    const raced = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "6",
    });
    models.purchaseOrder.create.mockRejectedValue(raced);
    await expect(
      repo.createPurchaseOrder(ACTOR_CTX, {
        supplierId: SUPPLIER,
        lines: [{ variantId: VARIANT, quantityOrdered: 1, unitCost: 100 }],
        idempotencyKey: "k1",
      }),
    ).rejects.toBe(raced);
  });

  it("rejects a garbled (non-decodable) cursor with InvalidListCursorError", async () => {
    const { repo } = makeRepo();
    await expect(
      repo.listSuppliers(COMPANY, {
        sort: { field: "name", dir: "asc" },
        active: true,
        cursor: "%%%not-a-valid-cursor%%%",
      }),
    ).rejects.toMatchObject({ name: "InvalidListCursorError" });
  });

  it("stores an explicit null expectedDate as null (not the omitted-field default)", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.supplier.findFirst.mockResolvedValue({ id: SUPPLIER });
    models.productVariant.findFirst.mockResolvedValue({ id: VARIANT });
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([{ next_number: 2n }]); // issuePoNumber
    models.purchaseOrder.create.mockResolvedValue({ id: PO });
    models.purchaseOrder.findFirstOrThrow.mockResolvedValue(poDetailRow());

    await repo.createPurchaseOrder(ACTOR_CTX, {
      supplierId: SUPPLIER,
      expectedDate: null,
      lines: [{ variantId: VARIANT, quantityOrdered: 10, unitCost: 1000 }],
    });

    const createArgs = models.purchaseOrder.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(createArgs.data["expectedDate"]).toBeNull();
  });

  it("finds a purchase order whose expectedDate is set (round-trips to an ISO string)", async () => {
    const { repo, models } = makeRepo();
    models.purchaseOrder.findFirst.mockResolvedValue(
      poDetailRow({ expectedDate: new Date("2026-02-01T00:00:00.000Z") }),
    );
    const row = await repo.findPurchaseOrder(COMPANY, PO);
    expect(row?.expectedDate).toBe("2026-02-01T00:00:00.000Z");
  });
});
