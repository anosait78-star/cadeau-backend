import type { KeysetPage } from "@cadeau/database";
import type {
  ExpenseView,
  ExpenseWriteResult,
  InvoiceListView,
  InvoicePdfData,
  InvoiceView,
  InvoiceWriteResult,
  PurchaseOrderListView,
  PurchaseOrderPaymentResult,
  PurchaseOrderReceiptResult,
  PurchaseOrderView,
  PurchaseOrderWriteResult,
  RefundView,
  RefundWriteResult,
  SupplierView,
  TaxSettingsView,
} from "./finance.entity";
import type {
  ParsedExpenseListQuery,
  ParsedInvoiceListQuery,
  ParsedPurchaseOrderListQuery,
  ParsedRefundListQuery,
  ParsedSupplierListQuery,
} from "./list-query";

/** The tenant + acting member for a write. */
export interface WriteActor {
  readonly companyId: string;
  readonly actorId: string;
}

/** Fields accepted when creating a supplier. */
export interface CreateSupplierInput {
  readonly name: string;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly address?: string | null;
  readonly taxId?: string | null;
}

/** Partial update for a supplier; omitted keys are left unchanged. */
export interface UpdateSupplierInput {
  readonly name?: string;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly address?: string | null;
  readonly taxId?: string | null;
  readonly active?: boolean;
}

/** One line requested on a new purchase order. */
export interface CreatePurchaseOrderLineInput {
  readonly variantId: string;
  readonly quantityOrdered: number;
  readonly unitCost: number;
}

/** Fields accepted when creating a purchase order (with its lines). */
export interface CreatePurchaseOrderInput {
  readonly supplierId: string;
  readonly expectedDate?: string | null;
  readonly notes?: string | null;
  readonly lines: readonly CreatePurchaseOrderLineInput[];
  readonly idempotencyKey?: string | undefined;
}

/** One line of an incoming receipt: the PO line and the quantity received now. */
export interface ReceiptLineInput {
  readonly poLineId: string;
  readonly quantity: number;
}

/** An atomic receipt request against a purchase order. */
export interface CreateReceiptInput {
  readonly warehouseId: string;
  readonly receivedAt?: string | undefined;
  readonly lines: readonly ReceiptLineInput[];
  readonly idempotencyKey?: string | undefined;
}

/** A (partial) payment request against a purchase order. */
export interface CreatePaymentInput {
  readonly amountMinor: number;
  readonly method: string;
  readonly paidAt?: string | undefined;
  readonly idempotencyKey?: string | undefined;
}

/** Fields accepted when creating an expense (M13.3). */
export interface CreateExpenseInput {
  readonly category: string;
  readonly amountMinor: number;
  readonly incurredAt: string;
  readonly notes?: string | null;
  readonly supplierId?: string | null;
  readonly idempotencyKey?: string | undefined;
}

/** Partial update for an expense; omitted keys are left unchanged. */
export interface UpdateExpenseInput {
  readonly category?: string;
  readonly amountMinor?: number;
  readonly incurredAt?: string;
  readonly notes?: string | null;
  readonly supplierId?: string | null;
}

/** Partial update for the company's tax settings; omitted keys are left unchanged. */
export interface UpdateTaxSettingsInput {
  readonly vatRateBps?: number;
  readonly vatRegistrationNumber?: string | null;
}

// ---- Invoices (M13.4) --------------------------------------------------------

/** One manual line requested on a new invoice (the no-order path). */
export interface CreateInvoiceLineInput {
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
}

/**
 * Fields accepted when issuing an invoice: EITHER `orderId` (lines are
 * derived read-only from the order's items) OR a manual `lines[]` — never
 * both, never neither (enforced by the service, {@link InvalidInvoiceSourceError}).
 */
export interface CreateInvoiceInput {
  readonly orderId?: string | undefined;
  readonly lines?: readonly CreateInvoiceLineInput[] | undefined;
  readonly idempotencyKey?: string | undefined;
}

// ---- Refunds (M13.4) ---------------------------------------------------------

/**
 * Fields accepted when issuing a refund. `idempotencyKey` is mandatory here
 * (unlike every other finance write) — the service rejects a missing header
 * before this ever reaches the repository ({@link MissingIdempotencyKeyError}).
 */
export interface CreateRefundInput {
  readonly invoiceId?: string | undefined;
  readonly orderId?: string | undefined;
  readonly amountMinor: number;
  readonly reason: string;
  readonly idempotencyKey: string;
}

/**
 * Port for reading and writing suppliers and purchase orders (EPIC-13,
 * M13.2). The Prisma adapter binds the tenant under RLS for every unit of
 * work (the app-layer half of the two-layer isolation model), issues PO
 * numbers via the atomic `purchase_order_sequences` upsert, and runs each
 * receipt inside **one transaction** that locks the affected
 * `inventory_stock` rows (`SELECT … FOR UPDATE`, reusing the EPIC-9
 * discipline) before raising `on_hand` and rolling
 * `product_variants.average_cost` by the moving-average formula (D7).
 *
 * A bad tenant reference surfaces as {@link ReferenceNotFoundError}; a bad
 * cursor as {@link InvalidListCursorError}. Not-found reads/writes return
 * `null`.
 */
export interface FinanceRepositoryPort {
  // ---- Suppliers -------------------------------------------------------------

  listSuppliers(
    companyId: string,
    query: ParsedSupplierListQuery,
  ): Promise<KeysetPage<SupplierView>>;

  findSupplier(companyId: string, id: string): Promise<SupplierView | null>;

  createSupplier(actor: WriteActor, data: CreateSupplierInput): Promise<SupplierView>;

  updateSupplier(
    actor: WriteActor,
    id: string,
    data: UpdateSupplierInput,
  ): Promise<SupplierView | null>;

  /** Archive a supplier (`is_active = false`). Returns the row, or `null` if absent. */
  archiveSupplier(actor: WriteActor, id: string): Promise<SupplierView | null>;

  // ---- Purchase orders ---------------------------------------------------------

  listPurchaseOrders(
    companyId: string,
    query: ParsedPurchaseOrderListQuery,
  ): Promise<KeysetPage<PurchaseOrderListView>>;

  findPurchaseOrder(companyId: string, id: string): Promise<PurchaseOrderView | null>;

  createPurchaseOrder(
    actor: WriteActor,
    data: CreatePurchaseOrderInput,
  ): Promise<PurchaseOrderWriteResult>;

  /**
   * Atomically receive stock against a purchase order: locks the affected
   * `inventory_stock` rows, raises `on_hand`, writes one `stock_adjustments`
   * row per receipt line (`reason = 'purchase_receipt'`), rolls
   * `product_variants.average_cost`, and advances the PO's `status`. Returns
   * `null` when the PO is unknown in this tenant.
   */
  receivePurchaseOrder(
    actor: WriteActor,
    poId: string,
    data: CreateReceiptInput,
  ): Promise<PurchaseOrderReceiptResult | null>;

  /** Record a (partial) payment. Returns `null` when the PO is unknown in this tenant. */
  payPurchaseOrder(
    actor: WriteActor,
    poId: string,
    data: CreatePaymentInput,
  ): Promise<PurchaseOrderPaymentResult | null>;

  // ---- Expenses (M13.3) -------------------------------------------------------

  listExpenses(companyId: string, query: ParsedExpenseListQuery): Promise<KeysetPage<ExpenseView>>;

  findExpense(companyId: string, id: string): Promise<ExpenseView | null>;

  /**
   * Create an expense. Rejects a date inside an already-closed accounting
   * period ({@link PeriodClosedError}, D4) and a positive-amount violation
   * ({@link InvalidAmountError}).
   */
  createExpense(actor: WriteActor, data: CreateExpenseInput): Promise<ExpenseWriteResult>;

  /**
   * Update an expense's mutable fields. Rejects when either the expense's
   * current `incurredAt` or a newly-requested one falls inside a closed
   * accounting period. Returns `null` when unknown in this tenant.
   */
  updateExpense(
    actor: WriteActor,
    id: string,
    data: UpdateExpenseInput,
  ): Promise<ExpenseView | null>;

  // ---- Tax settings (M13.3, D3) ------------------------------------------------

  /** Read the company's tax settings, lazily creating a default zero-rate row. */
  getTaxSettings(companyId: string): Promise<TaxSettingsView>;

  /** Update the company's tax settings (upsert semantics). */
  updateTaxSettings(actor: WriteActor, data: UpdateTaxSettingsInput): Promise<TaxSettingsView>;

  // ---- Invoices (M13.4) -------------------------------------------------------

  listInvoices(
    companyId: string,
    query: ParsedInvoiceListQuery,
  ): Promise<KeysetPage<InvoiceListView>>;

  findInvoice(companyId: string, id: string): Promise<InvoiceView | null>;

  /**
   * Issue an invoice: computes `subtotalMinor` from the resolved lines,
   * reads and freezes the current `tax_settings.vatRateBps`, rounds
   * `vatMinor` half-up, and issues the number via `invoice_sequences`.
   * Rejects a write dated inside a closed accounting period
   * ({@link PeriodClosedError}, D4, checked against the write time).
   */
  createInvoice(actor: WriteActor, data: CreateInvoiceInput): Promise<InvoiceWriteResult>;

  /**
   * Gather everything the PDF renderer needs for one invoice, and — on the
   * first call only (`pdfGeneratedAt` was `null`) — stamp `pdfGeneratedAt`.
   * Returns `null` when the invoice is unknown in this tenant.
   */
  getInvoicePdfData(companyId: string, id: string): Promise<InvoicePdfData | null>;

  // ---- Refunds (M13.4) ---------------------------------------------------------

  listRefunds(companyId: string, query: ParsedRefundListQuery): Promise<KeysetPage<RefundView>>;

  /**
   * Issue a refund. `data.idempotencyKey` is mandatory (the DB column is
   * `NOT NULL`). Rejects a write dated inside a closed accounting period
   * ({@link PeriodClosedError}, D4, checked against the write time).
   */
  createRefund(actor: WriteActor, data: CreateRefundInput): Promise<RefundWriteResult>;
}

/** DI token for {@link FinanceRepositoryPort}. */
export const FINANCE_REPOSITORY = Symbol("FINANCE_REPOSITORY");
