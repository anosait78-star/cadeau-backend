import { describe, expect, it, vi } from "vitest";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppException } from "../../../shared/errors/app-exception";
import type { EventBusPort } from "../../../shared/events/event-bus.port";
import type { Clock } from "../../../shared/time/clock";
import type { FinanceAuditPort } from "../domain/finance-audit.port";
import type { FinanceRepositoryPort } from "../domain/finance-repository.port";
import type {
  ExpenseView,
  InvoiceView,
  PurchaseOrderPaymentView,
  PurchaseOrderReceiptView,
  PurchaseOrderView,
  RefundView,
  SupplierView,
  TaxSettingsView,
} from "../domain/finance.entity";
import {
  EmptyPurchaseOrderError,
  IllegalPurchaseOrderStateError,
  InvalidVatRateError,
  MissingIdempotencyKeyError,
  OverReceiptError,
  PeriodClosedError,
  ReferenceNotFoundError,
} from "../domain/finance.errors";
import { FinanceService } from "./finance.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const SUPPLIER = "33333333-3333-3333-3333-333333333333";
const PO = "77777777-7777-7777-7777-777777777777";

function principal(overrides: Partial<RequestPrincipal> = {}): RequestPrincipal {
  return { userId: USER, sessionId: "s", companyId: COMPANY, ...overrides };
}

function supplier(extra: Partial<SupplierView> = {}): SupplierView {
  return {
    id: SUPPLIER,
    name: "Acme Trading",
    phone: null,
    email: null,
    address: null,
    taxId: null,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function order(extra: Partial<PurchaseOrderView> = {}): PurchaseOrderView {
  return {
    id: PO,
    number: 1,
    supplierId: SUPPLIER,
    status: "ordered",
    expectedDate: null,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lines: [],
    ...extra,
  };
}

function receipt(extra: Partial<PurchaseOrderReceiptView> = {}): PurchaseOrderReceiptView {
  return {
    id: "r1",
    poId: PO,
    warehouseId: "w1",
    receivedAt: "2026-01-01T00:00:00.000Z",
    lines: [],
    ...extra,
  };
}

function payment(extra: Partial<PurchaseOrderPaymentView> = {}): PurchaseOrderPaymentView {
  return {
    id: "p1",
    poId: PO,
    amountMinor: 5000,
    method: "cash",
    paidAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function emptyPage<T>(): KeysetPage<T> {
  return { data: [], page: { limit: 25, nextCursor: null, hasMore: false } };
}

function expense(extra: Partial<ExpenseView> = {}): ExpenseView {
  return {
    id: "e1",
    category: "office_supplies",
    amountMinor: 12500,
    incurredAt: "2026-01-01T00:00:00.000Z",
    notes: null,
    supplierId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function taxSettings(extra: Partial<TaxSettingsView> = {}): TaxSettingsView {
  return {
    companyId: COMPANY,
    vatRateBps: 0,
    vatRegistrationNumber: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function invoice(extra: Partial<InvoiceView> = {}): InvoiceView {
  return {
    id: "inv1",
    number: 1,
    orderId: null,
    subtotalMinor: 10000,
    vatMinor: 1400,
    totalMinor: 11400,
    vatRateBpsSnapshot: 1400,
    pdfGeneratedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lines: [
      {
        id: "l1",
        description: "Widget",
        quantity: 1,
        unitPriceMinor: 10000,
        lineTotalMinor: 10000,
      },
    ],
    ...extra,
  };
}

function refund(extra: Partial<RefundView> = {}): RefundView {
  return {
    id: "ref1",
    invoiceId: "inv1",
    orderId: null,
    amountMinor: 5000,
    reason: "Customer returned the item.",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function makeService() {
  const repo: FinanceRepositoryPort = {
    listSuppliers: vi.fn().mockResolvedValue(emptyPage()),
    findSupplier: vi.fn().mockResolvedValue(null),
    createSupplier: vi.fn(),
    updateSupplier: vi.fn().mockResolvedValue(null),
    archiveSupplier: vi.fn().mockResolvedValue(null),
    listPurchaseOrders: vi.fn().mockResolvedValue(emptyPage()),
    findPurchaseOrder: vi.fn().mockResolvedValue(null),
    createPurchaseOrder: vi.fn(),
    receivePurchaseOrder: vi.fn(),
    payPurchaseOrder: vi.fn(),
    listExpenses: vi.fn().mockResolvedValue(emptyPage()),
    findExpense: vi.fn().mockResolvedValue(null),
    createExpense: vi.fn(),
    updateExpense: vi.fn().mockResolvedValue(null),
    getTaxSettings: vi.fn().mockResolvedValue(taxSettings()),
    updateTaxSettings: vi.fn().mockResolvedValue(taxSettings()),
    listInvoices: vi.fn().mockResolvedValue(emptyPage()),
    findInvoice: vi.fn().mockResolvedValue(null),
    createInvoice: vi.fn(),
    getInvoicePdfData: vi.fn().mockResolvedValue(null),
    listRefunds: vi.fn().mockResolvedValue(emptyPage()),
    createRefund: vi.fn(),
  };
  const audit: FinanceAuditPort = { record: vi.fn().mockResolvedValue(undefined) };
  const events: EventBusPort = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
  };
  const clock: Clock = { now: () => 1_700_000_000_000 };
  const service = new FinanceService(repo, audit, events, clock);
  return { service, repo, audit, events };
}

describe("FinanceService — tenant guard", () => {
  it("rejects every call when no company is selected", async () => {
    const { service } = makeService();
    await expect(service.listSuppliers(principal({ companyId: null }), {})).rejects.toMatchObject({
      getStatus: expect.any(Function),
    });
  });
});

describe("FinanceService — suppliers", () => {
  it("creates a supplier and audits before returning", async () => {
    const { service, repo, audit } = makeService();
    vi.mocked(repo.createSupplier).mockResolvedValue(supplier());
    const row = await service.createSupplier(principal(), { name: "Acme Trading" });
    expect(row.id).toBe(SUPPLIER);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "supplier.created", entityId: SUPPLIER }),
    );
  });

  it("404s when the supplier to update is not found", async () => {
    const { service } = makeService();
    await expect(service.updateSupplier(principal(), "nope", {})).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it("archives and audits", async () => {
    const { service, repo, audit } = makeService();
    vi.mocked(repo.archiveSupplier).mockResolvedValue(supplier({ active: false }));
    await service.archiveSupplier(principal(), SUPPLIER);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "supplier.archived" }),
    );
  });
});

describe("FinanceService — purchase orders", () => {
  it("creates a PO, audits once, and does not audit a replay", async () => {
    const { service, repo, audit } = makeService();
    vi.mocked(repo.createPurchaseOrder).mockResolvedValue({ order: order(), replayed: false });
    await service.createPurchaseOrder(principal(), { supplierId: SUPPLIER, lines: [] as never });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "purchase_order.created" }),
    );

    vi.mocked(audit.record).mockClear();
    vi.mocked(repo.createPurchaseOrder).mockResolvedValue({ order: order(), replayed: true });
    await service.createPurchaseOrder(principal(), { supplierId: SUPPLIER, lines: [] as never });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("maps a reference-not-found error to 422", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.createPurchaseOrder).mockRejectedValue(new ReferenceNotFoundError("supplierId"));
    await expect(
      service.createPurchaseOrder(principal(), { supplierId: SUPPLIER, lines: [] as never }),
    ).rejects.toMatchObject({ getStatus: expect.any(Function) });
  });

  it("maps an empty-lines error to 400 validation", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.createPurchaseOrder).mockRejectedValue(new EmptyPurchaseOrderError());
    await expect(
      service.createPurchaseOrder(principal(), { supplierId: SUPPLIER, lines: [] as never }),
    ).rejects.toBeInstanceOf(AppException);
  });

  it("receives a PO: audits then emits purchase_order.received, in that order", async () => {
    const { service, repo, audit, events } = makeService();
    const calls: string[] = [];
    vi.mocked(audit.record).mockImplementation(async () => {
      calls.push("audit");
    });
    vi.mocked(events.publish).mockImplementation(async () => {
      calls.push("event");
    });
    vi.mocked(repo.receivePurchaseOrder).mockResolvedValue({
      receipt: receipt(),
      order: order({ status: "partially_received" }),
      replayed: false,
    });
    await service.receivePurchaseOrder(principal(), PO, { warehouseId: "w1", lines: [] as never });
    expect(calls).toEqual(["audit", "event"]);
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "purchase_order.received" }),
    );
  });

  it("does not audit or emit for a replayed receipt", async () => {
    const { service, repo, audit, events } = makeService();
    vi.mocked(repo.receivePurchaseOrder).mockResolvedValue({
      receipt: receipt(),
      order: order(),
      replayed: true,
    });
    await service.receivePurchaseOrder(principal(), PO, { warehouseId: "w1", lines: [] as never });
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it("404s when the PO to receive against is not found", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.receivePurchaseOrder).mockResolvedValue(null);
    await expect(
      service.receivePurchaseOrder(principal(), "nope", { warehouseId: "w1", lines: [] as never }),
    ).rejects.toBeInstanceOf(AppException);
  });

  it("maps an over-receipt error to 422", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.receivePurchaseOrder).mockRejectedValue(new OverReceiptError("l1", 5, 2));
    await expect(
      service.receivePurchaseOrder(principal(), PO, { warehouseId: "w1", lines: [] as never }),
    ).rejects.toMatchObject({ getStatus: expect.any(Function) });
  });

  it("maps an illegal-state error to 422", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.receivePurchaseOrder).mockRejectedValue(
      new IllegalPurchaseOrderStateError("received"),
    );
    await expect(
      service.receivePurchaseOrder(principal(), PO, { warehouseId: "w1", lines: [] as never }),
    ).rejects.toMatchObject({ getStatus: expect.any(Function) });
  });

  it("records a payment: audits then emits payment.recorded", async () => {
    const { service, repo, audit, events } = makeService();
    const calls: string[] = [];
    vi.mocked(audit.record).mockImplementation(async () => {
      calls.push("audit");
    });
    vi.mocked(events.publish).mockImplementation(async () => {
      calls.push("event");
    });
    vi.mocked(repo.payPurchaseOrder).mockResolvedValue({ payment: payment(), replayed: false });
    await service.payPurchaseOrder(principal(), PO, { amountMinor: 5000, method: "cash" });
    expect(calls).toEqual(["audit", "event"]);
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "payment.recorded" }),
    );
  });

  it("does not audit or emit for a replayed payment", async () => {
    const { service, repo, audit, events } = makeService();
    vi.mocked(repo.payPurchaseOrder).mockResolvedValue({ payment: payment(), replayed: true });
    await service.payPurchaseOrder(principal(), PO, { amountMinor: 5000, method: "cash" });
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it("404s when the PO to pay is not found", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.payPurchaseOrder).mockResolvedValue(null);
    await expect(
      service.payPurchaseOrder(principal(), "nope", { amountMinor: 100, method: "cash" }),
    ).rejects.toBeInstanceOf(AppException);
  });
});

describe("FinanceService — expenses", () => {
  it("creates an expense and audits once, but not on replay", async () => {
    const { service, repo, audit } = makeService();
    vi.mocked(repo.createExpense).mockResolvedValue({ expense: expense(), replayed: false });
    await service.createExpense(principal(), {
      category: "office_supplies",
      amountMinor: 12500,
      incurredAt: "2026-01-01T00:00:00.000Z",
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "expense.created", entityId: "e1" }),
    );

    vi.mocked(audit.record).mockClear();
    vi.mocked(repo.createExpense).mockResolvedValue({ expense: expense(), replayed: true });
    await service.createExpense(principal(), {
      category: "office_supplies",
      amountMinor: 12500,
      incurredAt: "2026-01-01T00:00:00.000Z",
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("maps a period-closed error to 409", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.createExpense).mockRejectedValue(new PeriodClosedError("2026-01"));
    await expect(
      service.createExpense(principal(), {
        category: "office_supplies",
        amountMinor: 12500,
        incurredAt: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ getStatus: expect.any(Function) });
  });

  it("updates an expense and audits", async () => {
    const { service, repo, audit } = makeService();
    vi.mocked(repo.updateExpense).mockResolvedValue(expense({ category: "travel" }));
    const row = await service.updateExpense(principal(), "e1", { category: "travel" });
    expect(row.category).toBe("travel");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "expense.updated" }),
    );
  });

  it("404s when the expense to update is not found", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.updateExpense).mockResolvedValue(null);
    await expect(
      service.updateExpense(principal(), "nope", { category: "travel" }),
    ).rejects.toBeInstanceOf(AppException);
  });

  it("404s when the expense to read is not found", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.findExpense).mockResolvedValue(null);
    await expect(service.getExpense(principal(), "nope")).rejects.toBeInstanceOf(AppException);
  });
});

describe("FinanceService — tax settings", () => {
  it("reads the company's tax settings", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.getTaxSettings).mockResolvedValue(taxSettings({ vatRateBps: 1400 }));
    const row = await service.getTaxSettings(principal());
    expect(row.vatRateBps).toBe(1400);
    expect(repo.getTaxSettings).toHaveBeenCalledWith(COMPANY);
  });

  it("updates the VAT rate and audits", async () => {
    const { service, repo, audit } = makeService();
    vi.mocked(repo.updateTaxSettings).mockResolvedValue(taxSettings({ vatRateBps: 1400 }));
    const row = await service.updateTaxSettings(principal(), { vatRateBps: 1400 });
    expect(row.vatRateBps).toBe(1400);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "tax_settings.updated" }),
    );
  });

  it("maps an invalid VAT rate to 400 validation", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.updateTaxSettings).mockRejectedValue(new InvalidVatRateError());
    await expect(
      service.updateTaxSettings(principal(), { vatRateBps: 20000 }),
    ).rejects.toBeInstanceOf(AppException);
  });
});

describe("FinanceService — invoices", () => {
  it("issues an order-based invoice and audits + emits, but not on replay", async () => {
    const { service, repo, audit, events } = makeService();
    vi.mocked(repo.createInvoice).mockResolvedValue({
      invoice: invoice({ orderId: "order1" }),
      replayed: false,
    });
    const row = await service.createInvoice(principal(), { orderId: "order1" });
    expect(row.id).toBe("inv1");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "invoice.issued", entityId: "inv1" }),
    );
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "invoice.issued",
        payload: { invoiceId: "inv1", orderId: "order1" },
      }),
    );

    vi.mocked(audit.record).mockClear();
    vi.mocked(events.publish).mockClear();
    vi.mocked(repo.createInvoice).mockResolvedValue({ invoice: invoice(), replayed: true });
    await service.createInvoice(principal(), { orderId: "order1" });
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it("issues a manual-lines invoice", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.createInvoice).mockResolvedValue({ invoice: invoice(), replayed: false });
    const row = await service.createInvoice(principal(), {
      lines: [{ description: "Widget", quantity: 1, unitPriceMinor: 10000 }],
    });
    expect(row.id).toBe("inv1");
    expect(repo.createInvoice).toHaveBeenCalled();
  });

  it("rejects an invoice with neither orderId nor lines", async () => {
    const { service, repo } = makeService();
    await expect(service.createInvoice(principal(), {})).rejects.toBeInstanceOf(AppException);
    expect(repo.createInvoice).not.toHaveBeenCalled();
  });

  it("rejects an invoice with both orderId and lines", async () => {
    const { service, repo } = makeService();
    await expect(
      service.createInvoice(principal(), {
        orderId: "order1",
        lines: [{ description: "Widget", quantity: 1, unitPriceMinor: 10000 }],
      }),
    ).rejects.toBeInstanceOf(AppException);
    expect(repo.createInvoice).not.toHaveBeenCalled();
  });

  it("maps a period-closed error to 409 on invoice issue", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.createInvoice).mockRejectedValue(new PeriodClosedError("2026-01"));
    await expect(service.createInvoice(principal(), { orderId: "order1" })).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it("404s when the invoice to read is not found", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.findInvoice).mockResolvedValue(null);
    await expect(service.getInvoice(principal(), "nope")).rejects.toBeInstanceOf(AppException);
  });

  it("404s when the invoice pdf data is not found", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.getInvoicePdfData).mockResolvedValue(null);
    await expect(service.getInvoicePdfData(principal(), "nope")).rejects.toBeInstanceOf(
      AppException,
    );
  });
});

describe("FinanceService — refunds", () => {
  it("issues a refund and audits + emits, but not on replay", async () => {
    const { service, repo, audit, events } = makeService();
    vi.mocked(repo.createRefund).mockResolvedValue({ refund: refund(), replayed: false });
    const row = await service.createRefund(principal(), {
      invoiceId: "inv1",
      amountMinor: 5000,
      reason: "Customer returned the item.",
      idempotencyKey: "key-1",
    });
    expect(row.id).toBe("ref1");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "refund.issued", entityId: "ref1" }),
    );
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "refund.issued",
        payload: { refundId: "ref1", amountMinor: 5000 },
      }),
    );

    vi.mocked(audit.record).mockClear();
    vi.mocked(events.publish).mockClear();
    vi.mocked(repo.createRefund).mockResolvedValue({ refund: refund(), replayed: true });
    await service.createRefund(principal(), {
      invoiceId: "inv1",
      amountMinor: 5000,
      reason: "Customer returned the item.",
      idempotencyKey: "key-1",
    });
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it("rejects a refund without an Idempotency-Key", async () => {
    const { service, repo } = makeService();
    await expect(
      service.createRefund(principal(), {
        invoiceId: "inv1",
        amountMinor: 5000,
        reason: "Customer returned the item.",
        idempotencyKey: undefined,
      }),
    ).rejects.toMatchObject({ getStatus: expect.any(Function) });
    expect(repo.createRefund).not.toHaveBeenCalled();
  });

  it("maps MissingIdempotencyKeyError to 400", async () => {
    const { service } = makeService();
    try {
      await service.createRefund(principal(), {
        amountMinor: 5000,
        reason: "x",
        idempotencyKey: undefined,
        invoiceId: "inv1",
      });
      throw new Error("expected to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      if (error instanceof AppException) expect(error.getStatus()).toBe(400);
      expect(error).not.toBeInstanceOf(MissingIdempotencyKeyError);
    }
  });

  it("rejects a refund with neither invoiceId nor orderId", async () => {
    const { service, repo } = makeService();
    await expect(
      service.createRefund(principal(), {
        amountMinor: 5000,
        reason: "Customer returned the item.",
        idempotencyKey: "key-1",
      }),
    ).rejects.toBeInstanceOf(AppException);
    expect(repo.createRefund).not.toHaveBeenCalled();
  });

  it("maps a period-closed error to 409 on refund issue", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.createRefund).mockRejectedValue(new PeriodClosedError("2026-01"));
    await expect(
      service.createRefund(principal(), {
        invoiceId: "inv1",
        amountMinor: 5000,
        reason: "x",
        idempotencyKey: "key-1",
      }),
    ).rejects.toBeInstanceOf(AppException);
  });
});
