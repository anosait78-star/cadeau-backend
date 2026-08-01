/**
 * Branch coverage for `FinanceService` paths not exercised by
 * `finance.service.test.ts`'s happy-path/audit-ordering suite: list-query
 * validation failures, not-found reads, `createInvoice`'s
 * exactly-one-source guard, `createRefund`'s mandatory-key/target guards,
 * and every remaining `mapError` branch (including the unmapped-error
 * passthrough).
 */
import { describe, expect, it, vi } from "vitest";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppException } from "../../../shared/errors/app-exception";
import type { EventBusPort } from "../../../shared/events/event-bus.port";
import type { Clock } from "../../../shared/time/clock";
import type { FinanceAuditPort } from "../domain/finance-audit.port";
import type { FinanceRepositoryPort } from "../domain/finance-repository.port";
import type { InvoicePdfRendererPort } from "../domain/invoice-pdf.port";
import type {
  ExpenseView,
  InvoiceView,
  PurchaseOrderView,
  ReconciliationView,
  SupplierView,
  TaxSettingsView,
} from "../domain/finance.entity";
import {
  EmptyInvoiceError,
  InvalidAmountError,
  InvalidInvoiceSourceError,
  InvalidListCursorError,
  MissingIdempotencyKeyError,
  RefundTargetRequiredError,
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

function reconciliation(extra: Partial<ReconciliationView> = {}): ReconciliationView {
  return {
    id: "rec1",
    carrier: "manual",
    statementRef: "STMT-2026-01",
    periodKey: "2026-01",
    totalStatementMinor: 5000,
    totalFeeMinor: 4800,
    totalVarianceMinor: 200,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lines: [],
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

function emptyPage<T>(): KeysetPage<T> {
  return { data: [], page: { limit: 25, nextCursor: null, hasMore: false } };
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
    listReconciliations: vi.fn().mockResolvedValue(emptyPage()),
    findReconciliation: vi.fn().mockResolvedValue(null),
    createReconciliation: vi.fn(),
    listPeriods: vi.fn().mockResolvedValue([]),
    closePeriod: vi.fn(),
    getCashCenterReport: vi.fn(),
    getPnlReport: vi.fn(),
  };
  const audit: FinanceAuditPort = { record: vi.fn().mockResolvedValue(undefined) };
  const events: EventBusPort = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
  };
  const clock: Clock = { now: () => 1_700_000_000_000 };
  const pdfRenderer: InvoicePdfRendererPort = {
    render: vi.fn().mockResolvedValue(Buffer.from("%PDF-fake")),
  };
  const service = new FinanceService(repo, audit, events, clock, pdfRenderer);
  return { service, repo, audit, events, pdfRenderer };
}

describe("FinanceService — list-query validation failures", () => {
  it("rejects an invalid supplier list query before hitting the repository", async () => {
    const { service, repo } = makeService();
    await expect(service.listSuppliers(principal(), { active: "bogus" })).rejects.toBeInstanceOf(
      AppException,
    );
    expect(repo.listSuppliers).not.toHaveBeenCalled();
  });

  it("rejects an invalid purchase-order list query", async () => {
    const { service, repo } = makeService();
    await expect(
      service.listPurchaseOrders(principal(), { status: "bogus" }),
    ).rejects.toBeInstanceOf(AppException);
    expect(repo.listPurchaseOrders).not.toHaveBeenCalled();
  });

  it("rejects an invalid expense list query", async () => {
    const { service, repo } = makeService();
    await expect(
      service.listExpenses(principal(), { supplierId: "not-a-uuid" }),
    ).rejects.toBeInstanceOf(AppException);
    expect(repo.listExpenses).not.toHaveBeenCalled();
  });

  it("rejects an invalid invoice list query", async () => {
    const { service, repo } = makeService();
    await expect(
      service.listInvoices(principal(), { orderId: "not-a-uuid" }),
    ).rejects.toBeInstanceOf(AppException);
    expect(repo.listInvoices).not.toHaveBeenCalled();
  });

  it("rejects an invalid refund list query", async () => {
    const { service, repo } = makeService();
    await expect(
      service.listRefunds(principal(), { invoiceId: "not-a-uuid" }),
    ).rejects.toBeInstanceOf(AppException);
    expect(repo.listRefunds).not.toHaveBeenCalled();
  });

  it("rejects an invalid reconciliation list query", async () => {
    const { service, repo } = makeService();
    await expect(
      service.listReconciliations(principal(), { periodKey: "bogus" }),
    ).rejects.toBeInstanceOf(AppException);
    expect(repo.listReconciliations).not.toHaveBeenCalled();
  });

  it("passes a valid expense/invoice/refund list query straight through to the repository", async () => {
    const { service, repo } = makeService();
    await service.listExpenses(principal(), {});
    expect(repo.listExpenses).toHaveBeenCalled();
    await service.listInvoices(principal(), {});
    expect(repo.listInvoices).toHaveBeenCalled();
    await service.listRefunds(principal(), {});
    expect(repo.listRefunds).toHaveBeenCalled();
  });

  it("rejects a report range query missing dateFrom/dateTo", async () => {
    const { service, repo } = makeService();
    await expect(service.getCashCenterReport(principal(), {})).rejects.toBeInstanceOf(AppException);
    expect(repo.getCashCenterReport).not.toHaveBeenCalled();
    await expect(service.getPnlReport(principal(), {})).rejects.toBeInstanceOf(AppException);
    expect(repo.getPnlReport).not.toHaveBeenCalled();
  });

  it("passes a valid report range straight through, including comparison dates", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.getPnlReport).mockResolvedValue({
      current: { revenueMinor: 0, cogsMinor: 0, expensesMinor: 0, netIncomeMinor: 0 },
    });
    await service.getPnlReport(principal(), {
      dateFrom: "2026-01-01T00:00:00.000Z",
      dateTo: "2026-01-31T00:00:00.000Z",
      compareFrom: "2025-12-01T00:00:00.000Z",
      compareTo: "2025-12-31T00:00:00.000Z",
    });
    expect(repo.getPnlReport).toHaveBeenCalledWith(
      COMPANY,
      "2026-01-01T00:00:00.000Z",
      "2026-01-31T00:00:00.000Z",
      "2025-12-01T00:00:00.000Z",
      "2025-12-31T00:00:00.000Z",
    );
  });
});

describe("FinanceService — not-found reads", () => {
  it("404s getSupplier, getPurchaseOrder, getExpense, getInvoice, getReconciliation", async () => {
    const { service } = makeService();
    await expect(service.getSupplier(principal(), "nope")).rejects.toBeInstanceOf(AppException);
    await expect(service.getPurchaseOrder(principal(), "nope")).rejects.toBeInstanceOf(
      AppException,
    );
    await expect(service.getExpense(principal(), "nope")).rejects.toBeInstanceOf(AppException);
    await expect(service.getInvoice(principal(), "nope")).rejects.toBeInstanceOf(AppException);
    await expect(service.getReconciliation(principal(), "nope")).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it("returns the row when found, for every simple by-id read", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.findSupplier).mockResolvedValue(supplier());
    expect((await service.getSupplier(principal(), SUPPLIER)).id).toBe(SUPPLIER);

    vi.mocked(repo.findPurchaseOrder).mockResolvedValue(order());
    expect((await service.getPurchaseOrder(principal(), PO)).id).toBe(PO);

    vi.mocked(repo.findExpense).mockResolvedValue(expense());
    expect((await service.getExpense(principal(), "e1")).id).toBe("e1");

    vi.mocked(repo.findInvoice).mockResolvedValue(invoice());
    expect((await service.getInvoice(principal(), "inv1")).id).toBe("inv1");

    vi.mocked(repo.findReconciliation).mockResolvedValue(reconciliation());
    expect((await service.getReconciliation(principal(), "rec1")).id).toBe("rec1");
  });

  it("updates a supplier successfully (no throw) and audits", async () => {
    const { service, repo, audit } = makeService();
    vi.mocked(repo.updateSupplier).mockResolvedValue(supplier({ name: "New name" }));
    const row = await service.updateSupplier(principal(), SUPPLIER, { name: "New name" });
    expect(row.name).toBe("New name");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "supplier.updated" }),
    );
  });

  it("404s archiveSupplier when the repository finds no row", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.archiveSupplier).mockResolvedValue(null);
    await expect(service.archiveSupplier(principal(), "nope")).rejects.toBeInstanceOf(AppException);
  });

  it("404s getInvoicePdfData and renderInvoicePdf when the invoice is missing", async () => {
    const { service, pdfRenderer } = makeService();
    await expect(service.getInvoicePdfData(principal(), "nope")).rejects.toBeInstanceOf(
      AppException,
    );
    await expect(service.renderInvoicePdf(principal(), "nope")).rejects.toBeInstanceOf(
      AppException,
    );
    expect(pdfRenderer.render).not.toHaveBeenCalled();
  });

  it("renders a found invoice's PDF via the port", async () => {
    const { service, repo, pdfRenderer } = makeService();
    vi.mocked(repo.getInvoicePdfData).mockResolvedValue({
      invoice: invoice(),
      companyName: "Acme",
      vatRegistrationNumber: null,
      billToName: null,
    });
    const result = await service.renderInvoicePdf(principal(), "inv1");
    expect(pdfRenderer.render).toHaveBeenCalled();
    expect(result.invoiceNumber).toBe("1");
    expect(result.buffer.toString()).toBe("%PDF-fake");
  });
});

describe("FinanceService — createInvoice source guard", () => {
  it("rejects when neither orderId nor lines is provided", async () => {
    const { service, repo } = makeService();
    await expect(service.createInvoice(principal(), {})).rejects.toBeInstanceOf(AppException);
    expect(repo.createInvoice).not.toHaveBeenCalled();
  });

  it("rejects when both orderId and lines are provided", async () => {
    const { service, repo } = makeService();
    await expect(
      service.createInvoice(principal(), {
        orderId: "order1",
        lines: [{ description: "Widget", quantity: 1, unitPriceMinor: 100 }],
      }),
    ).rejects.toBeInstanceOf(AppException);
    expect(repo.createInvoice).not.toHaveBeenCalled();
  });

  it("rejects an empty manual lines array as if lines were absent", async () => {
    const { service, repo } = makeService();
    await expect(service.createInvoice(principal(), { lines: [] })).rejects.toBeInstanceOf(
      AppException,
    );
    expect(repo.createInvoice).not.toHaveBeenCalled();
  });

  it("accepts orderId alone", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.createInvoice).mockResolvedValue({ invoice: invoice(), replayed: false });
    await service.createInvoice(principal(), { orderId: "order1" });
    expect(repo.createInvoice).toHaveBeenCalled();
  });
});

describe("FinanceService — createRefund guards", () => {
  it("rejects a refund with no Idempotency-Key", async () => {
    const { service, repo } = makeService();
    await expect(
      service.createRefund(principal(), { invoiceId: "inv1", amountMinor: 100, reason: "x" }),
    ).rejects.toBeInstanceOf(AppException);
    expect(repo.createRefund).not.toHaveBeenCalled();
  });

  it("rejects a refund with neither invoiceId nor orderId", async () => {
    const { service, repo } = makeService();
    await expect(
      service.createRefund(principal(), {
        amountMinor: 100,
        reason: "x",
        idempotencyKey: "k1",
      }),
    ).rejects.toBeInstanceOf(AppException);
    expect(repo.createRefund).not.toHaveBeenCalled();
  });
});

describe("FinanceService — mapError, every remaining branch", () => {
  it("maps InvalidAmountError to a 400 validation error", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.payPurchaseOrder).mockRejectedValue(new InvalidAmountError("amountMinor"));
    await expect(
      service.payPurchaseOrder(principal(), "po1", { amountMinor: 0, method: "cash" }),
    ).rejects.toBeInstanceOf(AppException);
  });

  it("maps InvalidListCursorError to a 400 bad request", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.listSuppliers).mockRejectedValue(new InvalidListCursorError());
    await expect(service.listSuppliers(principal(), {})).rejects.toBeInstanceOf(AppException);
  });

  it("maps EmptyInvoiceError to a 400 validation error", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.createInvoice).mockRejectedValue(new EmptyInvoiceError());
    await expect(service.createInvoice(principal(), { orderId: "order1" })).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it("maps InvalidInvoiceSourceError to a 400 validation error via repo throw path", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.createInvoice).mockRejectedValue(new InvalidInvoiceSourceError());
    await expect(service.createInvoice(principal(), { orderId: "order1" })).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it("maps RefundTargetRequiredError to a 400 validation error via repo throw path", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.createRefund).mockRejectedValue(new RefundTargetRequiredError());
    await expect(
      service.createRefund(principal(), {
        invoiceId: "inv1",
        amountMinor: 100,
        reason: "x",
        idempotencyKey: "k1",
      }),
    ).rejects.toBeInstanceOf(AppException);
  });

  it("maps MissingIdempotencyKeyError to a 400 bad request via repo throw path", async () => {
    const { service, repo } = makeService();
    vi.mocked(repo.createRefund).mockRejectedValue(new MissingIdempotencyKeyError());
    await expect(
      service.createRefund(principal(), {
        invoiceId: "inv1",
        amountMinor: 100,
        reason: "x",
        idempotencyKey: "k1",
      }),
    ).rejects.toBeInstanceOf(AppException);
  });

  it("maps InvalidPeriodKeyError to a 400 validation error", async () => {
    const { service } = makeService();
    await expect(service.closePeriod(principal(), "bogus")).rejects.toBeInstanceOf(AppException);
  });

  it("passes an unrecognized error straight through unmapped", async () => {
    const { service, repo } = makeService();
    const weird = new Error("something unexpected");
    vi.mocked(repo.listPurchaseOrders).mockRejectedValue(weird);
    await expect(service.listPurchaseOrders(principal(), {})).rejects.toBe(weird);
  });
});
