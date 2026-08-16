import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppErrors, AppException } from "../../../shared/errors/app-exception";
import { withErrorMapping } from "../../../shared/errors/with-error-mapping";
import { EVENT_BUS, type EventBusPort } from "../../../shared/events/event-bus.port";
import { CLOCK, type Clock } from "../../../shared/time/clock";
import type { FinanceAuditPort, FinanceAuditRecord } from "../domain/finance-audit.port";
import type { InvoicePdfRendererPort } from "../domain/invoice-pdf.port";
import { INVOICE_PDF_RENDERER } from "../domain/invoice-pdf.port";
import { FINANCE_AUDIT } from "../domain/finance-audit.port";
import {
  FINANCE_REPOSITORY,
  type CreateExpenseInput,
  type CreateInvoiceInput,
  type CreatePaymentInput,
  type CreatePurchaseOrderInput,
  type CreateReceiptInput,
  type CreateReconciliationInput,
  type CreateRefundInput,
  type CreateSupplierInput,
  type FinanceRepositoryPort,
  type UpdateExpenseInput,
  type UpdateSupplierInput,
  type UpdateTaxSettingsInput,
} from "../domain/finance-repository.port";
import type {
  AccountingPeriodView,
  CashCenterReportView,
  ExpenseView,
  InvoiceListView,
  InvoicePdfData,
  InvoiceView,
  PnlReportView,
  PurchaseOrderListView,
  PurchaseOrderPaymentView,
  PurchaseOrderReceiptView,
  PurchaseOrderView,
  ReconciliationListView,
  ReconciliationView,
  RefundView,
  SupplierView,
  TaxSettingsView,
} from "../domain/finance.entity";
import {
  EmptyInvoiceError,
  EmptyPurchaseOrderError,
  EmptyReconciliationError,
  IllegalPurchaseOrderStateError,
  InvalidAmountError,
  InvalidInvoiceSourceError,
  InvalidListCursorError,
  InvalidPeriodKeyError,
  InvalidVatRateError,
  MissingIdempotencyKeyError,
  OverReceiptError,
  PeriodClosedError,
  PeriodSequenceGapError,
  RefundTargetRequiredError,
  ReferenceNotFoundError,
  ShipmentNotFoundForReconciliationError,
} from "../domain/finance.errors";
import {
  parseExpenseListQuery,
  parseInvoiceListQuery,
  parsePurchaseOrderListQuery,
  parseReconciliationListQuery,
  parseRefundListQuery,
  parseReportRangeQuery,
  parseSupplierListQuery,
  type RawExpenseListQuery,
  type RawInvoiceListQuery,
  type RawPurchaseOrderListQuery,
  type RawReconciliationListQuery,
  type RawRefundListQuery,
  type RawReportRangeQuery,
  type RawSupplierListQuery,
} from "../domain/list-query";

/**
 * Orchestrates the finance module's suppliers + purchase orders (EPIC-13,
 * M13.2). It enforces the tenant scope (every operation requires an active
 * company), delegates the atomic receipt and PO-number issuance to the
 * repository, and — for each write — records a durable audit row **before**
 * publishing its domain event (ADR-0004, audit-then-emit). An idempotent
 * replay writes nothing new, so it audits and emits nothing: the original
 * request already did. Access is gated by the controllers'
 * `@RequireCapability`; this service assumes an authorized caller.
 */
@Injectable()
export class FinanceService {
  constructor(
    @Inject(FINANCE_REPOSITORY) private readonly repo: FinanceRepositoryPort,
    @Inject(FINANCE_AUDIT) private readonly audit: FinanceAuditPort,
    @Inject(EVENT_BUS) private readonly events: EventBusPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(INVOICE_PDF_RENDERER) private readonly pdfRenderer: InvoicePdfRendererPort,
  ) {}

  // ---- Suppliers ---------------------------------------------------------------

  async listSuppliers(
    principal: RequestPrincipal,
    rawQuery: RawSupplierListQuery,
  ): Promise<KeysetPage<SupplierView>> {
    const companyId = this.requireTenant(principal);
    const { query, errors } = parseSupplierListQuery(rawQuery);
    if (query === undefined) throw AppErrors.validation("Request validation failed", errors);
    return withErrorMapping(
      () => this.repo.listSuppliers(companyId, query),
      (error) => this.mapError(error),
    );
  }

  async getSupplier(principal: RequestPrincipal, id: string): Promise<SupplierView> {
    const companyId = this.requireTenant(principal);
    const row = await this.repo.findSupplier(companyId, id);
    if (row === null) throw AppErrors.notFound("Supplier not found.");
    return row;
  }

  async createSupplier(
    principal: RequestPrincipal,
    data: CreateSupplierInput,
  ): Promise<SupplierView> {
    const companyId = this.requireTenant(principal);
    const row = await this.repo.createSupplier({ companyId, actorId: principal.userId }, data);
    await this.record(companyId, principal.userId, {
      action: "supplier.created",
      entityType: "supplier",
      entityId: row.id,
      changes: row,
    });
    return row;
  }

  async updateSupplier(
    principal: RequestPrincipal,
    id: string,
    data: UpdateSupplierInput,
  ): Promise<SupplierView> {
    const companyId = this.requireTenant(principal);
    const row = await this.repo.updateSupplier({ companyId, actorId: principal.userId }, id, data);
    if (row === null) throw AppErrors.notFound("Supplier not found.");
    await this.record(companyId, principal.userId, {
      action: "supplier.updated",
      entityType: "supplier",
      entityId: row.id,
      changes: row,
    });
    return row;
  }

  async archiveSupplier(principal: RequestPrincipal, id: string): Promise<void> {
    const companyId = this.requireTenant(principal);
    const row = await this.repo.archiveSupplier({ companyId, actorId: principal.userId }, id);
    if (row === null) throw AppErrors.notFound("Supplier not found.");
    await this.record(companyId, principal.userId, {
      action: "supplier.archived",
      entityType: "supplier",
      entityId: row.id,
      changes: row,
    });
  }

  // ---- Purchase orders -----------------------------------------------------

  async listPurchaseOrders(
    principal: RequestPrincipal,
    rawQuery: RawPurchaseOrderListQuery,
  ): Promise<KeysetPage<PurchaseOrderListView>> {
    const companyId = this.requireTenant(principal);
    const { query, errors } = parsePurchaseOrderListQuery(rawQuery);
    if (query === undefined) throw AppErrors.validation("Request validation failed", errors);
    return withErrorMapping(
      () => this.repo.listPurchaseOrders(companyId, query),
      (error) => this.mapError(error),
    );
  }

  async getPurchaseOrder(principal: RequestPrincipal, id: string): Promise<PurchaseOrderView> {
    const companyId = this.requireTenant(principal);
    const row = await this.repo.findPurchaseOrder(companyId, id);
    if (row === null) throw AppErrors.notFound("Purchase order not found.");
    return row;
  }

  async createPurchaseOrder(
    principal: RequestPrincipal,
    data: CreatePurchaseOrderInput,
  ): Promise<PurchaseOrderView> {
    const companyId = this.requireTenant(principal);
    const result = await withErrorMapping(
      () => this.repo.createPurchaseOrder({ companyId, actorId: principal.userId }, data),
      (error) => this.mapError(error),
    );
    if (!result.replayed) {
      await this.record(companyId, principal.userId, {
        action: "purchase_order.created",
        entityType: "purchase_order",
        entityId: result.order.id,
        changes: result.order,
      });
    }
    return result.order;
  }

  async receivePurchaseOrder(
    principal: RequestPrincipal,
    id: string,
    data: CreateReceiptInput,
  ): Promise<PurchaseOrderReceiptView> {
    const companyId = this.requireTenant(principal);
    const result = await withErrorMapping(
      () => this.repo.receivePurchaseOrder({ companyId, actorId: principal.userId }, id, data),
      (error) => this.mapError(error),
    );
    if (result === null) throw AppErrors.notFound("Purchase order not found.");
    if (!result.replayed) {
      await this.record(companyId, principal.userId, {
        action: "purchase_order.received",
        entityType: "purchase_order_receipt",
        entityId: result.receipt.id,
        changes: { receipt: result.receipt, order: result.order },
      });
      await this.events.publish({
        type: "purchase_order.received",
        companyId,
        actorId: principal.userId,
        occurredAt: this.clock.now(),
        payload: { purchaseOrderId: result.order.id, receiptId: result.receipt.id },
      });
    }
    return result.receipt;
  }

  async payPurchaseOrder(
    principal: RequestPrincipal,
    id: string,
    data: CreatePaymentInput,
  ): Promise<PurchaseOrderPaymentView> {
    const companyId = this.requireTenant(principal);
    const result = await withErrorMapping(
      () => this.repo.payPurchaseOrder({ companyId, actorId: principal.userId }, id, data),
      (error) => this.mapError(error),
    );
    if (result === null) throw AppErrors.notFound("Purchase order not found.");
    if (!result.replayed) {
      await this.record(companyId, principal.userId, {
        action: "purchase_order.payment_recorded",
        entityType: "purchase_order_payment",
        entityId: result.payment.id,
        changes: result.payment,
      });
      await this.events.publish({
        type: "payment.recorded",
        companyId,
        actorId: principal.userId,
        occurredAt: this.clock.now(),
        payload: { purchaseOrderId: id, amountMinor: result.payment.amountMinor },
      });
    }
    return result.payment;
  }

  // ---- Expenses (M13.3) --------------------------------------------------------

  async listExpenses(
    principal: RequestPrincipal,
    rawQuery: RawExpenseListQuery,
  ): Promise<KeysetPage<ExpenseView>> {
    const companyId = this.requireTenant(principal);
    const { query, errors } = parseExpenseListQuery(rawQuery);
    if (query === undefined) throw AppErrors.validation("Request validation failed", errors);
    return withErrorMapping(
      () => this.repo.listExpenses(companyId, query),
      (error) => this.mapError(error),
    );
  }

  async getExpense(principal: RequestPrincipal, id: string): Promise<ExpenseView> {
    const companyId = this.requireTenant(principal);
    const row = await this.repo.findExpense(companyId, id);
    if (row === null) throw AppErrors.notFound("Expense not found.");
    return row;
  }

  async createExpense(principal: RequestPrincipal, data: CreateExpenseInput): Promise<ExpenseView> {
    const companyId = this.requireTenant(principal);
    const result = await withErrorMapping(
      () => this.repo.createExpense({ companyId, actorId: principal.userId }, data),
      (error) => this.mapError(error),
    );
    if (!result.replayed) {
      await this.record(companyId, principal.userId, {
        action: "expense.created",
        entityType: "expense",
        entityId: result.expense.id,
        changes: result.expense,
      });
    }
    return result.expense;
  }

  async updateExpense(
    principal: RequestPrincipal,
    id: string,
    data: UpdateExpenseInput,
  ): Promise<ExpenseView> {
    const companyId = this.requireTenant(principal);
    const row: ExpenseView | null = await withErrorMapping(
      () => this.repo.updateExpense({ companyId, actorId: principal.userId }, id, data),
      (error) => this.mapError(error),
    );
    if (row === null) throw AppErrors.notFound("Expense not found.");
    await this.record(companyId, principal.userId, {
      action: "expense.updated",
      entityType: "expense",
      entityId: row.id,
      changes: row,
    });
    return row;
  }

  // ---- Tax settings (M13.3, D3) ------------------------------------------------

  async getTaxSettings(principal: RequestPrincipal): Promise<TaxSettingsView> {
    const companyId = this.requireTenant(principal);
    return this.repo.getTaxSettings(companyId);
  }

  async updateTaxSettings(
    principal: RequestPrincipal,
    data: UpdateTaxSettingsInput,
  ): Promise<TaxSettingsView> {
    const companyId = this.requireTenant(principal);
    const row: TaxSettingsView = await withErrorMapping(
      () => this.repo.updateTaxSettings({ companyId, actorId: principal.userId }, data),
      (error) => this.mapError(error),
    );
    await this.record(companyId, principal.userId, {
      action: "tax_settings.updated",
      entityType: "tax_settings",
      entityId: row.companyId,
      changes: row,
    });
    return row;
  }

  // ---- Invoices (M13.4) --------------------------------------------------------

  async listInvoices(
    principal: RequestPrincipal,
    rawQuery: RawInvoiceListQuery,
  ): Promise<KeysetPage<InvoiceListView>> {
    const companyId = this.requireTenant(principal);
    const { query, errors } = parseInvoiceListQuery(rawQuery);
    if (query === undefined) throw AppErrors.validation("Request validation failed", errors);
    return withErrorMapping(
      () => this.repo.listInvoices(companyId, query),
      (error) => this.mapError(error),
    );
  }

  async getInvoice(principal: RequestPrincipal, id: string): Promise<InvoiceView> {
    const companyId = this.requireTenant(principal);
    const row = await this.repo.findInvoice(companyId, id);
    if (row === null) throw AppErrors.notFound("Invoice not found.");
    return row;
  }

  async createInvoice(principal: RequestPrincipal, data: CreateInvoiceInput): Promise<InvoiceView> {
    const companyId = this.requireTenant(principal);
    const hasOrder = data.orderId !== undefined;
    const hasLines = data.lines !== undefined && data.lines.length > 0;
    if (hasOrder === hasLines) throw this.mapError(new InvalidInvoiceSourceError());

    const result = await withErrorMapping(
      () => this.repo.createInvoice({ companyId, actorId: principal.userId }, data),
      (error) => this.mapError(error),
    );
    if (!result.replayed) {
      await this.record(companyId, principal.userId, {
        action: "invoice.issued",
        entityType: "invoice",
        entityId: result.invoice.id,
        changes: result.invoice,
      });
      await this.events.publish({
        type: "invoice.issued",
        companyId,
        actorId: principal.userId,
        occurredAt: this.clock.now(),
        payload: { invoiceId: result.invoice.id, orderId: result.invoice.orderId },
      });
    }
    return result.invoice;
  }

  /** Read everything the presentation layer needs to stream the invoice PDF. */
  async getInvoicePdfData(principal: RequestPrincipal, id: string): Promise<InvoicePdfData> {
    const companyId = this.requireTenant(principal);
    const data = await this.repo.getInvoicePdfData(companyId, id);
    if (data === null) throw AppErrors.notFound("Invoice not found.");
    return data;
  }

  /**
   * Render the invoice PDF (pdfkit, D1). Kept in the application layer — not
   * the presentation layer — so `presentation` never imports `infrastructure`
   * directly (architecture rule: dependencies point inward only).
   */
  async renderInvoicePdf(
    principal: RequestPrincipal,
    id: string,
  ): Promise<{ buffer: Buffer; invoiceNumber: string }> {
    const data = await this.getInvoicePdfData(principal, id);
    const buffer = await this.pdfRenderer.render(data);
    return { buffer, invoiceNumber: String(data.invoice.number) };
  }

  // ---- Refunds (M13.4) ---------------------------------------------------------

  async listRefunds(
    principal: RequestPrincipal,
    rawQuery: RawRefundListQuery,
  ): Promise<KeysetPage<RefundView>> {
    const companyId = this.requireTenant(principal);
    const { query, errors } = parseRefundListQuery(rawQuery);
    if (query === undefined) throw AppErrors.validation("Request validation failed", errors);
    return withErrorMapping(
      () => this.repo.listRefunds(companyId, query),
      (error) => this.mapError(error),
    );
  }

  /**
   * Issue a refund. `Idempotency-Key` is mandatory here (unlike every other
   * finance write) — a missing header is rejected before this ever reaches
   * the repository ({@link MissingIdempotencyKeyError}, mapped to `400`).
   */
  async createRefund(
    principal: RequestPrincipal,
    data: Omit<CreateRefundInput, "idempotencyKey"> & { idempotencyKey?: string | undefined },
  ): Promise<RefundView> {
    const companyId = this.requireTenant(principal);
    if (data.idempotencyKey === undefined) throw this.mapError(new MissingIdempotencyKeyError());
    if (data.invoiceId === undefined && data.orderId === undefined) {
      throw this.mapError(new RefundTargetRequiredError());
    }

    const idempotencyKey = data.idempotencyKey;
    const result = await withErrorMapping(
      () =>
        this.repo.createRefund(
          { companyId, actorId: principal.userId },
          { ...data, idempotencyKey },
        ),
      (error) => this.mapError(error),
    );
    if (!result.replayed) {
      await this.record(companyId, principal.userId, {
        action: "refund.issued",
        entityType: "refund",
        entityId: result.refund.id,
        changes: result.refund,
      });
      await this.events.publish({
        type: "refund.issued",
        companyId,
        actorId: principal.userId,
        occurredAt: this.clock.now(),
        payload: { refundId: result.refund.id, amountMinor: result.refund.amountMinor },
      });
    }
    return result.refund;
  }

  // ---- Shipping reconciliation (M13.5, D5) --------------------------------------

  async listReconciliations(
    principal: RequestPrincipal,
    rawQuery: RawReconciliationListQuery,
  ): Promise<KeysetPage<ReconciliationListView>> {
    const companyId = this.requireTenant(principal);
    const { query, errors } = parseReconciliationListQuery(rawQuery);
    if (query === undefined) throw AppErrors.validation("Request validation failed", errors);
    return withErrorMapping(
      () => this.repo.listReconciliations(companyId, query),
      (error) => this.mapError(error),
    );
  }

  async getReconciliation(principal: RequestPrincipal, id: string): Promise<ReconciliationView> {
    const companyId = this.requireTenant(principal);
    const row = await this.repo.findReconciliation(companyId, id);
    if (row === null) throw AppErrors.notFound("Reconciliation not found.");
    return row;
  }

  async createReconciliation(
    principal: RequestPrincipal,
    data: CreateReconciliationInput,
  ): Promise<ReconciliationView> {
    const companyId = this.requireTenant(principal);
    const result = await withErrorMapping(
      () => this.repo.createReconciliation({ companyId, actorId: principal.userId }, data),
      (error) => this.mapError(error),
    );
    if (!result.replayed) {
      await this.record(companyId, principal.userId, {
        action: "shipping_reconciliation.created",
        entityType: "shipping_reconciliation",
        entityId: result.reconciliation.id,
        changes: result.reconciliation,
      });
      // No event is defined for reconciliation in the closed catalog
      // (event-catalog.ts) — audit only, same treatment as expenses/tax
      // settings (M13.3).
    }
    return result.reconciliation;
  }

  // ---- Accounting periods (M13.5, D4) -------------------------------------------

  async listPeriods(principal: RequestPrincipal): Promise<readonly AccountingPeriodView[]> {
    const companyId = this.requireTenant(principal);
    return this.repo.listPeriods(companyId);
  }

  async closePeriod(principal: RequestPrincipal, periodKey: string): Promise<AccountingPeriodView> {
    const companyId = this.requireTenant(principal);
    if (!/^\d{4}-\d{2}$/.test(periodKey)) throw this.mapError(new InvalidPeriodKeyError());

    const result = await withErrorMapping(
      () => this.repo.closePeriod({ companyId, actorId: principal.userId }, periodKey),
      (error) => this.mapError(error),
    );
    if (!result.replayed) {
      await this.record(companyId, principal.userId, {
        action: "period.closed",
        entityType: "accounting_period",
        entityId: result.period.id,
        changes: result.period,
      });
      await this.events.publish({
        type: "period.closed",
        companyId,
        actorId: principal.userId,
        occurredAt: this.clock.now(),
        payload: { periodKey: result.period.periodKey },
      });
    }
    return result.period;
  }

  // ---- Cash center + P&L (M13.5, D6 — computed reads) ----------------------------

  async getCashCenterReport(
    principal: RequestPrincipal,
    rawQuery: RawReportRangeQuery,
  ): Promise<CashCenterReportView> {
    const companyId = this.requireTenant(principal);
    const { query, errors } = parseReportRangeQuery(rawQuery);
    if (query === undefined) throw AppErrors.validation("Request validation failed", errors);
    return this.repo.getCashCenterReport(companyId, query.dateFrom, query.dateTo);
  }

  async getPnlReport(
    principal: RequestPrincipal,
    rawQuery: RawReportRangeQuery,
  ): Promise<PnlReportView> {
    const companyId = this.requireTenant(principal);
    const { query, errors } = parseReportRangeQuery(rawQuery);
    if (query === undefined) throw AppErrors.validation("Request validation failed", errors);
    return this.repo.getPnlReport(
      companyId,
      query.dateFrom,
      query.dateTo,
      query.compareFrom,
      query.compareTo,
    );
  }

  // ---- internals -----------------------------------------------------------

  private async record(
    companyId: string,
    actorId: string,
    entry: Omit<FinanceAuditRecord, "companyId" | "actorId">,
  ): Promise<void> {
    await this.audit.record({ companyId, actorId, ...entry });
  }

  private requireTenant(principal: RequestPrincipal): string {
    if (principal.companyId === null) {
      throw AppErrors.forbidden("Select an active company first.");
    }
    return principal.companyId;
  }

  private mapError(error: unknown): unknown {
    if (error instanceof ReferenceNotFoundError) {
      return new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "UNPROCESSABLE_ENTITY",
        error.message,
        [{ field: error.field, messages: [error.message] }],
      );
    }
    if (error instanceof EmptyPurchaseOrderError) {
      return AppErrors.validation(error.message, [{ field: "lines", messages: [error.message] }]);
    }
    if (error instanceof InvalidAmountError) {
      return AppErrors.validation(error.message, [
        { field: error.field, messages: [error.message] },
      ]);
    }
    if (error instanceof OverReceiptError) {
      return new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "UNPROCESSABLE_ENTITY",
        error.message,
        [{ field: "quantity", messages: [error.message] }],
      );
    }
    if (error instanceof IllegalPurchaseOrderStateError) {
      return new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "UNPROCESSABLE_ENTITY",
        error.message,
        [{ field: "status", messages: [error.message] }],
      );
    }
    if (error instanceof InvalidListCursorError) {
      return AppErrors.badRequest(error.message);
    }
    if (error instanceof PeriodClosedError) {
      return AppErrors.conflict(error.message, [
        { field: "incurredAt", messages: [error.message] },
      ]);
    }
    if (error instanceof InvalidVatRateError) {
      return AppErrors.validation(error.message, [
        { field: "vatRateBps", messages: [error.message] },
      ]);
    }
    if (error instanceof EmptyInvoiceError) {
      return AppErrors.validation(error.message, [{ field: "lines", messages: [error.message] }]);
    }
    if (error instanceof InvalidInvoiceSourceError) {
      return AppErrors.validation(error.message, [{ field: "orderId", messages: [error.message] }]);
    }
    if (error instanceof RefundTargetRequiredError) {
      return AppErrors.validation(error.message, [
        { field: "invoiceId", messages: [error.message] },
      ]);
    }
    if (error instanceof MissingIdempotencyKeyError) {
      return AppErrors.badRequest(error.message);
    }
    if (error instanceof EmptyReconciliationError) {
      return AppErrors.validation(error.message, [{ field: "lines", messages: [error.message] }]);
    }
    if (error instanceof ShipmentNotFoundForReconciliationError) {
      return new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "UNPROCESSABLE_ENTITY",
        error.message,
        [{ field: "trackingNumber", messages: [error.message] }],
      );
    }
    if (error instanceof InvalidPeriodKeyError) {
      return AppErrors.validation(error.message, [{ field: "period", messages: [error.message] }]);
    }
    if (error instanceof PeriodSequenceGapError) {
      return AppErrors.conflict(error.message, [{ field: "period", messages: [error.message] }]);
    }
    return error;
  }
}
