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

function taxSettingsRow(extra: Record<string, unknown> = {}) {
  return {
    companyId: COMPANY,
    vatRateBps: 0,
    vatRegistrationNumber: null,
    updatedAt: NOW,
    ...extra,
  };
}

const INVOICE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORDER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const REFUND = "cccccccc-cccc-cccc-cccc-cccccccccccc";

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

function refundRow(extra: Record<string, unknown> = {}) {
  return {
    id: REFUND,
    invoiceId: INVOICE,
    orderId: null,
    amountMinor: 5000n,
    reason: "Customer returned the item.",
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

const RECONCILIATION = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const SHIPMENT = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

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

function periodRow(extra: Record<string, unknown> = {}) {
  return {
    id: "period1",
    periodKey: "2026-01",
    status: "open",
    closedAt: null,
    closedBy: null,
    createdAt: NOW,
    updatedAt: NOW,
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

describe("FinanceRepository — expenses", () => {
  it("creates an expense (period open, no accounting_periods row)", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen: no row -> open
    models.expense.create.mockResolvedValue(expenseRow());
    const result = await repo.createExpense(ACTOR_CTX, {
      category: "office_supplies",
      amountMinor: 12500,
      incurredAt: "2026-01-02T00:00:00.000Z",
    });
    expect(result.replayed).toBe(false);
    expect(result.expense.amountMinor).toBe(12500);
  });

  it("rejects an expense dated inside a closed accounting period", async () => {
    const { repo, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([{ status: "closed" }]); // assertPeriodOpen
    await expect(
      repo.createExpense(ACTOR_CTX, {
        category: "office_supplies",
        amountMinor: 12500,
        incurredAt: "2026-01-02T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ name: "PeriodClosedError" });
  });

  it("rejects a non-positive amount", async () => {
    const { repo } = makeRepo();
    await expect(
      repo.createExpense(ACTOR_CTX, {
        category: "office_supplies",
        amountMinor: 0,
        incurredAt: "2026-01-02T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ name: "InvalidAmountError" });
  });

  it("rejects an unknown supplier", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    models.supplier.findFirst.mockResolvedValue(null);
    await expect(
      repo.createExpense(ACTOR_CTX, {
        category: "office_supplies",
        amountMinor: 12500,
        incurredAt: "2026-01-02T00:00:00.000Z",
        supplierId: SUPPLIER,
      }),
    ).rejects.toMatchObject({ name: "ReferenceNotFoundError" });
  });

  it("lists expenses", async () => {
    const { repo, models } = makeRepo();
    models.expense.findMany.mockResolvedValue([expenseRow()]);
    const page = await repo.listExpenses(COMPANY, {
      sort: { field: "incurredAt", dir: "desc" },
    });
    expect(page.data).toHaveLength(1);
  });

  it("filters expenses by category, supplier, and date range", async () => {
    const { repo, models } = makeRepo();
    models.expense.findMany.mockResolvedValue([]);
    await repo.listExpenses(COMPANY, {
      sort: { field: "incurredAt", dir: "desc" },
      category: "travel",
      supplierId: SUPPLIER,
      dateFrom: "2026-01-01T00:00:00.000Z",
      dateTo: "2026-01-31T00:00:00.000Z",
    });
    const args = models.expense.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ category: "travel", supplierId: SUPPLIER });
    expect(args.where["incurredAt"]).toBeDefined();
  });

  it("finds an expense by id", async () => {
    const { repo, models } = makeRepo();
    models.expense.findFirst.mockResolvedValue(expenseRow());
    expect(await repo.findExpense(COMPANY, "exp1")).not.toBeNull();
  });

  it("updates only the provided fields", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    models.expense.findFirst
      .mockResolvedValueOnce(expenseRow())
      .mockResolvedValueOnce(expenseRow({ category: "travel" }));
    const row = await repo.updateExpense(ACTOR_CTX, "exp1", { category: "travel" });
    expect(row?.category).toBe("travel");
    const args = models.expense.updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(args.data).toMatchObject({ category: "travel" });
    expect(args.data).not.toHaveProperty("amountMinor");
  });

  it("returns null when the expense to update is not in this tenant", async () => {
    const { repo, models } = makeRepo();
    models.expense.findFirst.mockResolvedValue(null);
    expect(await repo.updateExpense(ACTOR_CTX, "nope", { category: "travel" })).toBeNull();
  });

  it("rejects updating an expense whose current date is in a closed period", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    models.expense.findFirst.mockResolvedValue(expenseRow());
    queryRaw.mockResolvedValueOnce([{ status: "closed" }]); // assertPeriodOpen (existing date)
    await expect(
      repo.updateExpense(ACTOR_CTX, "exp1", { category: "travel" }),
    ).rejects.toMatchObject({ name: "PeriodClosedError" });
  });
});

describe("FinanceRepository — tax settings", () => {
  it("lazily creates a default zero-rate row on first read", async () => {
    const { repo, models } = makeRepo();
    models.taxSettings.upsert.mockResolvedValue(taxSettingsRow());
    const row = await repo.getTaxSettings(COMPANY);
    expect(row.vatRateBps).toBe(0);
    expect(row.vatRegistrationNumber).toBeNull();
  });

  it("updates the VAT rate and registration number", async () => {
    const { repo, models } = makeRepo();
    models.taxSettings.upsert.mockResolvedValue(
      taxSettingsRow({ vatRateBps: 1400, vatRegistrationNumber: "VAT-1" }),
    );
    const row = await repo.updateTaxSettings(ACTOR_CTX, {
      vatRateBps: 1400,
      vatRegistrationNumber: "VAT-1",
    });
    expect(row.vatRateBps).toBe(1400);
    expect(row.vatRegistrationNumber).toBe("VAT-1");
  });

  it("rejects a vatRateBps outside 0-10000", async () => {
    const { repo } = makeRepo();
    await expect(repo.updateTaxSettings(ACTOR_CTX, { vatRateBps: 10001 })).rejects.toMatchObject({
      name: "InvalidVatRateError",
    });
    await expect(repo.updateTaxSettings(ACTOR_CTX, { vatRateBps: -1 })).rejects.toMatchObject({
      name: "InvalidVatRateError",
    });
  });
});

describe("FinanceRepository — invoices", () => {
  it("issues a manual-lines invoice with VAT computed and rounded half-up", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    models.taxSettings.upsert.mockResolvedValue(taxSettingsRow({ vatRateBps: 1400 }));
    queryRaw.mockResolvedValueOnce([{ next_number: 2n }]); // issueInvoiceNumber
    models.invoice.create.mockResolvedValue({ id: INVOICE });
    models.invoiceLine.create.mockResolvedValue({});
    models.invoice.findFirstOrThrow.mockResolvedValue(invoiceDetailRow());

    const result = await repo.createInvoice(ACTOR_CTX, {
      lines: [{ description: "Widget", quantity: 1, unitPriceMinor: 10000 }],
    });
    expect(result.replayed).toBe(false);

    const createArgs = models.invoice.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    // 10000 * 1400bps / 10000 = 1400.0 exactly.
    expect(createArgs.data).toMatchObject({
      subtotalMinor: 10000n,
      vatMinor: 1400n,
      totalMinor: 11400n,
      vatRateBpsSnapshot: 1400,
      orderId: null,
    });
  });

  it("issues an order-based invoice deriving lines from order items", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    models.order.findFirst.mockResolvedValue({
      id: ORDER,
      items: [{ nameSnapshot: "Widget", quantity: 3n, price: 2000n }],
    });
    models.taxSettings.upsert.mockResolvedValue(taxSettingsRow({ vatRateBps: 1400 }));
    queryRaw.mockResolvedValueOnce([{ next_number: 2n }]);
    models.invoice.create.mockResolvedValue({ id: INVOICE });
    models.invoiceLine.create.mockResolvedValue({});
    models.invoice.findFirstOrThrow.mockResolvedValue(invoiceDetailRow({ orderId: ORDER }));

    const result = await repo.createInvoice(ACTOR_CTX, { orderId: ORDER });
    expect(result.invoice.orderId).toBe(ORDER);

    const createArgs = models.invoice.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    // subtotal = 3 * 2000 = 6000; vat = (6000*1400+5000)/10000 = 840 (rounds .5 up).
    expect(createArgs.data).toMatchObject({
      orderId: ORDER,
      subtotalMinor: 6000n,
      vatMinor: 840n,
      totalMinor: 6840n,
    });
    const lineArgs = models.invoiceLine.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(lineArgs.data).toMatchObject({
      description: "Widget",
      quantity: 3n,
      unitPriceMinor: 2000n,
    });
  });

  it("rejects an invoice for an unknown order", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    models.order.findFirst.mockResolvedValue(null);
    await expect(repo.createInvoice(ACTOR_CTX, { orderId: ORDER })).rejects.toMatchObject({
      name: "ReferenceNotFoundError",
    });
  });

  it("rejects an invoice with a non-positive manual line quantity", async () => {
    const { repo, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    await expect(
      repo.createInvoice(ACTOR_CTX, {
        lines: [{ description: "Widget", quantity: 0, unitPriceMinor: 10000 }],
      }),
    ).rejects.toMatchObject({ name: "InvalidAmountError" });
  });

  it("rejects an empty manual-lines invoice", async () => {
    const { repo, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    await expect(repo.createInvoice(ACTOR_CTX, { lines: [] })).rejects.toMatchObject({
      name: "EmptyInvoiceError",
    });
  });

  it("rejects an invoice dated inside a closed accounting period", async () => {
    const { repo, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([{ status: "closed" }]); // assertPeriodOpen
    await expect(
      repo.createInvoice(ACTOR_CTX, {
        lines: [{ description: "Widget", quantity: 1, unitPriceMinor: 10000 }],
      }),
    ).rejects.toMatchObject({ name: "PeriodClosedError" });
  });

  it("lists invoices", async () => {
    const { repo, models } = makeRepo();
    models.invoice.findMany.mockResolvedValue([invoiceDetailRow()]);
    const page = await repo.listInvoices(COMPANY, { sort: { field: "createdAt", dir: "desc" } });
    expect(page.data).toHaveLength(1);
  });

  it("finds an invoice by id, with lines", async () => {
    const { repo, models } = makeRepo();
    models.invoice.findFirst.mockResolvedValue(invoiceDetailRow());
    const row = await repo.findInvoice(COMPANY, INVOICE);
    expect(row?.lines).toHaveLength(1);
  });

  it("gathers PDF data and stamps pdfGeneratedAt on first render only", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    models.invoice.findFirst.mockResolvedValueOnce(
      invoiceDetailRow({ orderId: ORDER, pdfGeneratedAt: null }),
    );
    models.invoice.findFirstOrThrow.mockResolvedValueOnce(
      invoiceDetailRow({ orderId: ORDER, pdfGeneratedAt: NOW }),
    );
    models.company.findFirst.mockResolvedValue({ name: "Acme Trading" });
    models.taxSettings.findFirst.mockResolvedValue({ vatRegistrationNumber: "VAT-1" });
    models.order.findFirst.mockResolvedValue({ customer: { name: "Jane Customer" } });

    const data = await repo.getInvoicePdfData(COMPANY, INVOICE);
    expect(data).not.toBeNull();
    expect(data?.companyName).toBe("Acme Trading");
    expect(data?.vatRegistrationNumber).toBe("VAT-1");
    expect(data?.billToName).toBe("Jane Customer");
    expect(data?.invoice.pdfGeneratedAt).not.toBeNull();
    expect(models.invoice.updateMany).toHaveBeenCalled();
  });

  it("does not re-stamp pdfGeneratedAt on a second render", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    models.invoice.findFirst.mockResolvedValueOnce(invoiceDetailRow({ pdfGeneratedAt: NOW }));
    models.company.findFirst.mockResolvedValue({ name: "Acme Trading" });
    models.taxSettings.findFirst.mockResolvedValue({ vatRegistrationNumber: null });

    const data = await repo.getInvoicePdfData(COMPANY, INVOICE);
    expect(data).not.toBeNull();
    expect(models.invoice.updateMany).not.toHaveBeenCalled();
  });

  it("returns null pdf data for an unknown invoice", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    models.invoice.findFirst.mockResolvedValue(null);
    expect(await repo.getInvoicePdfData(COMPANY, "nope")).toBeNull();
  });
});

describe("FinanceRepository — refunds", () => {
  it("issues a refund against an invoice", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    models.invoice.findFirst.mockResolvedValue({ id: INVOICE });
    models.refund.create.mockResolvedValue(refundRow());

    const result = await repo.createRefund(ACTOR_CTX, {
      invoiceId: INVOICE,
      amountMinor: 5000,
      reason: "Customer returned the item.",
      idempotencyKey: "key-1",
    });
    expect(result.replayed).toBe(false);
    expect(result.refund.amountMinor).toBe(5000);
  });

  it("issues a refund against an order", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    models.order.findFirst.mockResolvedValue({ id: ORDER });
    models.refund.create.mockResolvedValue(refundRow({ invoiceId: null, orderId: ORDER }));

    const result = await repo.createRefund(ACTOR_CTX, {
      orderId: ORDER,
      amountMinor: 5000,
      reason: "Customer returned the item.",
      idempotencyKey: "key-1",
    });
    expect(result.refund.orderId).toBe(ORDER);
  });

  it("rejects a refund against an unknown invoice", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    models.invoice.findFirst.mockResolvedValue(null);
    await expect(
      repo.createRefund(ACTOR_CTX, {
        invoiceId: INVOICE,
        amountMinor: 5000,
        reason: "x",
        idempotencyKey: "key-1",
      }),
    ).rejects.toMatchObject({ name: "ReferenceNotFoundError" });
  });

  it("rejects a non-positive refund amount", async () => {
    const { repo } = makeRepo();
    await expect(
      repo.createRefund(ACTOR_CTX, {
        invoiceId: INVOICE,
        amountMinor: 0,
        reason: "x",
        idempotencyKey: "key-1",
      }),
    ).rejects.toMatchObject({ name: "InvalidAmountError" });
  });

  it("rejects a refund dated inside a closed accounting period", async () => {
    const { repo, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([{ status: "closed" }]); // assertPeriodOpen
    await expect(
      repo.createRefund(ACTOR_CTX, {
        invoiceId: INVOICE,
        amountMinor: 5000,
        reason: "x",
        idempotencyKey: "key-1",
      }),
    ).rejects.toMatchObject({ name: "PeriodClosedError" });
  });

  it("lists refunds", async () => {
    const { repo, models } = makeRepo();
    models.refund.findMany.mockResolvedValue([refundRow()]);
    const page = await repo.listRefunds(COMPANY, { sort: { field: "createdAt", dir: "desc" } });
    expect(page.data).toHaveLength(1);
  });
});

describe("FinanceRepository — shipping reconciliation (M13.5, D5)", () => {
  it("matches every line to a shipment and computes the variance atomically", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen (no row -> touched open)
    models.shipment.findFirst.mockResolvedValue({ id: SHIPMENT, fee: 4800n });
    models.shippingReconciliation.create.mockResolvedValue({ id: RECONCILIATION });
    models.shippingReconciliation.findFirstOrThrow.mockResolvedValue(reconciliationDetailRow());

    const result = await repo.createReconciliation(ACTOR_CTX, {
      carrier: "manual",
      statementRef: "STMT-2026-01",
      periodKey: "2026-01",
      lines: [{ trackingNumber: "TRK1", statementAmountMinor: 5000 }],
    });

    expect(result.replayed).toBe(false);
    expect(result.reconciliation.totalVarianceMinor).toBe(200);
    expect(result.reconciliation.lines).toHaveLength(1);
    expect(models.shippingReconciliationLine.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shipmentId: SHIPMENT,
          statementAmountMinor: 5000n,
          shipmentFeeMinor: 4800n,
          varianceMinor: 200n,
        }),
      }),
    );
    const headerArgs = models.shippingReconciliation.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(headerArgs.data).toMatchObject({
      totalStatementMinor: 5000n,
      totalFeeMinor: 4800n,
      totalVarianceMinor: 200n,
    });
  });

  it("rejects the whole batch when one tracking number has no matching shipment", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen
    models.shipment.findFirst
      .mockResolvedValueOnce({ id: SHIPMENT, fee: 4800n })
      .mockResolvedValueOnce(null);

    await expect(
      repo.createReconciliation(ACTOR_CTX, {
        carrier: "manual",
        statementRef: "STMT-2026-01",
        periodKey: "2026-01",
        lines: [
          { trackingNumber: "TRK1", statementAmountMinor: 5000 },
          { trackingNumber: "TRK-nope", statementAmountMinor: 1000 },
        ],
      }),
    ).rejects.toMatchObject({ name: "ShipmentNotFoundForReconciliationError" });
    expect(models.shippingReconciliation.create).not.toHaveBeenCalled();
  });

  it("rejects an empty line list before opening a transaction", async () => {
    const { repo } = makeRepo();
    await expect(
      repo.createReconciliation(ACTOR_CTX, {
        carrier: "manual",
        statementRef: "STMT-2026-01",
        periodKey: "2026-01",
        lines: [],
      }),
    ).rejects.toMatchObject({ name: "EmptyReconciliationError" });
  });

  it("rejects a reconciliation dated inside a closed accounting period", async () => {
    const { repo, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([{ status: "closed" }]); // assertPeriodOpen
    await expect(
      repo.createReconciliation(ACTOR_CTX, {
        carrier: "manual",
        statementRef: "STMT-2026-01",
        periodKey: "2026-01",
        lines: [{ trackingNumber: "TRK1", statementAmountMinor: 5000 }],
      }),
    ).rejects.toMatchObject({ name: "PeriodClosedError" });
  });

  it("replays a stored reconciliation for a repeated key", async () => {
    const { repo, models } = makeRepo();
    models.shippingReconciliation.findFirst.mockResolvedValue(reconciliationDetailRow());
    const result = await repo.createReconciliation(ACTOR_CTX, {
      carrier: "manual",
      statementRef: "STMT-2026-01",
      periodKey: "2026-01",
      lines: [{ trackingNumber: "TRK1", statementAmountMinor: 5000 }],
      idempotencyKey: "key-1",
    });
    expect(result.replayed).toBe(true);
    expect(models.shippingReconciliation.create).not.toHaveBeenCalled();
  });

  it("finds a reconciliation with its lines", async () => {
    const { repo, models } = makeRepo();
    models.shippingReconciliation.findFirst.mockResolvedValue(reconciliationDetailRow());
    const row = await repo.findReconciliation(COMPANY, RECONCILIATION);
    expect(row?.lines).toHaveLength(1);
  });

  it("lists reconciliations", async () => {
    const { repo, models } = makeRepo();
    models.shippingReconciliation.findMany.mockResolvedValue([reconciliationDetailRow()]);
    const page = await repo.listReconciliations(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
    });
    expect(page.data).toHaveLength(1);
  });
});

describe("FinanceRepository — accounting periods (M13.5, D4)", () => {
  it("touches a period into existence as open on the first dated write of the month", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // assertPeriodOpen SELECT: no row
    models.expense.create.mockResolvedValue(expenseRow());

    await repo.createExpense(ACTOR_CTX, {
      category: "office_supplies",
      amountMinor: 12500,
      incurredAt: "2026-01-02T00:00:00.000Z",
    });

    expect(models.accountingPeriod.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId_periodKey: { companyId: COMPANY, periodKey: "2026-01" } },
        create: { companyId: COMPANY, periodKey: "2026-01", status: "open" },
      }),
    );
  });

  it("does not touch the period again once it already has a row", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([{ status: "open" }]); // assertPeriodOpen SELECT: row exists
    models.expense.create.mockResolvedValue(expenseRow());

    await repo.createExpense(ACTOR_CTX, {
      category: "office_supplies",
      amountMinor: 12500,
      incurredAt: "2026-01-02T00:00:00.000Z",
    });

    expect(models.accountingPeriod.upsert).not.toHaveBeenCalled();
  });

  it("lists periods ascending by periodKey", async () => {
    const { repo, models } = makeRepo();
    models.accountingPeriod.findMany.mockResolvedValue([periodRow()]);
    const rows = await repo.listPeriods(COMPANY);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.periodKey).toBe("2026-01");
  });

  it("closes an open period", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // lock: no existing row
    queryRaw.mockResolvedValueOnce([]); // sequential gap check: none
    models.accountingPeriod.upsert.mockResolvedValue(
      periodRow({ status: "closed", closedAt: NOW, closedBy: ACTOR }),
    );

    const result = await repo.closePeriod(ACTOR_CTX, "2026-01");
    expect(result.replayed).toBe(false);
    expect(result.period.status).toBe("closed");
    expect(models.accountingPeriod.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId_periodKey: { companyId: COMPANY, periodKey: "2026-01" } },
      }),
    );
  });

  it("rejects closing period N while an earlier period is still open (D4)", async () => {
    const { repo, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // lock: no existing row for 2026-02
    queryRaw.mockResolvedValueOnce([{ period_key: "2026-01" }]); // sequential gap: Jan still open

    await expect(repo.closePeriod(ACTOR_CTX, "2026-02")).rejects.toMatchObject({
      name: "PeriodSequenceGapError",
    });
  });

  it("replays an already-closed period without re-running the sequential check", async () => {
    const { repo, models, queryRaw } = makeRepo();
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([
      {
        id: "period1",
        status: "closed",
        closed_at: NOW,
        closed_by: ACTOR,
        created_at: NOW,
        updated_at: NOW,
      },
    ]); // lock: already closed

    const result = await repo.closePeriod(ACTOR_CTX, "2026-01");
    expect(result.replayed).toBe(true);
    expect(result.period.status).toBe("closed");
    expect(models.accountingPeriod.upsert).not.toHaveBeenCalled();
    // Only setTenantContext + the lock ran; the gap check never fired.
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});

describe("FinanceRepository — cash center + P&L (M13.5, D6)", () => {
  it("computes the cash-center summary from known fixtures", async () => {
    const { repo, models } = makeRepo();
    models.order.aggregate.mockResolvedValue({ _sum: { collectedAmount: 500000n } });
    models.expense.aggregate.mockResolvedValue({ _sum: { amountMinor: 80000n } });
    models.purchaseOrderPayment.aggregate.mockResolvedValue({ _sum: { amountMinor: 120000n } });
    models.refund.aggregate.mockResolvedValue({ _sum: { amountMinor: 10000n } });
    models.shipment.aggregate.mockResolvedValue({ _sum: { fee: 30000n } });

    const report = await repo.getCashCenterReport(
      COMPANY,
      "2026-01-01T00:00:00.000Z",
      "2026-01-31T23:59:59.000Z",
    );

    expect(report).toEqual({
      collectedMinor: 500000,
      expensesMinor: 80000,
      purchaseOrderPaymentsMinor: 120000,
      refundsMinor: 10000,
      shippingFeesMinor: 30000,
      netCashMinor: 500000 - 80000 - 120000 - 10000 - 30000,
    });
  });

  it("treats missing sums as zero", async () => {
    const { repo, models } = makeRepo();
    models.order.aggregate.mockResolvedValue({ _sum: { collectedAmount: null } });
    models.expense.aggregate.mockResolvedValue({ _sum: { amountMinor: null } });
    models.purchaseOrderPayment.aggregate.mockResolvedValue({ _sum: { amountMinor: null } });
    models.refund.aggregate.mockResolvedValue({ _sum: { amountMinor: null } });
    models.shipment.aggregate.mockResolvedValue({ _sum: { fee: null } });

    const report = await repo.getCashCenterReport(
      COMPANY,
      "2026-01-01T00:00:00.000Z",
      "2026-01-31T23:59:59.000Z",
    );
    expect(report.netCashMinor).toBe(0);
  });

  it("computes P&L for the current period only", async () => {
    const { repo, models } = makeRepo();
    models.invoice.aggregate.mockResolvedValue({ _sum: { subtotalMinor: 100000n } });
    models.orderItem.findMany.mockResolvedValue([
      { costSnapshot: 2000n, quantity: 5n },
      { costSnapshot: 1000n, quantity: 10n },
    ]);
    models.expense.aggregate.mockResolvedValue({ _sum: { amountMinor: 10000n } });

    const report = await repo.getPnlReport(
      COMPANY,
      "2026-01-01T00:00:00.000Z",
      "2026-01-31T23:59:59.000Z",
    );

    // cogs = 2000*5 + 1000*10 = 20000
    expect(report.current).toEqual({
      revenueMinor: 100000,
      cogsMinor: 20000,
      expensesMinor: 10000,
      netIncomeMinor: 100000 - 20000 - 10000,
    });
    expect(report.previous).toBeUndefined();
  });

  it("computes P&L with a comparison period", async () => {
    const { repo, models } = makeRepo();
    models.invoice.aggregate
      .mockResolvedValueOnce({ _sum: { subtotalMinor: 100000n } })
      .mockResolvedValueOnce({ _sum: { subtotalMinor: 80000n } });
    models.orderItem.findMany
      .mockResolvedValueOnce([{ costSnapshot: 2000n, quantity: 5n }])
      .mockResolvedValueOnce([{ costSnapshot: 1000n, quantity: 5n }]);
    models.expense.aggregate
      .mockResolvedValueOnce({ _sum: { amountMinor: 10000n } })
      .mockResolvedValueOnce({ _sum: { amountMinor: 8000n } });

    const report = await repo.getPnlReport(
      COMPANY,
      "2026-01-01T00:00:00.000Z",
      "2026-01-31T23:59:59.000Z",
      "2025-12-01T00:00:00.000Z",
      "2025-12-31T23:59:59.000Z",
    );

    expect(report.current.revenueMinor).toBe(100000);
    expect(report.previous?.revenueMinor).toBe(80000);
    expect(report.previous?.cogsMinor).toBe(5000);
  });
});
