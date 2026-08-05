/**
 * Finance domain views (EPIC-13, M13.2 — suppliers + purchase orders). The
 * shapes the application layer returns and the presentation layer renders —
 * decoupled from the Prisma row. Money is an integer minor-units `number`
 * (api-conventions §12.1); quantities are whole units.
 */

/** A goods/services supplier. */
export interface SupplierView {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly taxId: string | null;
  /** Soft-delete flag; `false` means archived. */
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The closed set of purchase-order statuses (mirrors the DB CHECK). */
export const PURCHASE_ORDER_STATUSES = [
  "draft",
  "ordered",
  "partially_received",
  "received",
  "cancelled",
] as const;

/** A purchase-order status. */
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

/** A line on a purchase order: a pinned variant, ordered/received quantity, unit cost. */
export interface PurchaseOrderLineView {
  readonly id: string;
  readonly variantId: string;
  readonly quantityOrdered: number;
  readonly quantityReceived: number;
  readonly unitCost: number;
}

/** A purchase order without its lines (list rendering). */
export interface PurchaseOrderListView {
  readonly id: string;
  readonly number: number;
  readonly supplierId: string;
  readonly status: PurchaseOrderStatus;
  readonly expectedDate: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A purchase order with its lines (detail rendering). */
export interface PurchaseOrderView extends PurchaseOrderListView {
  readonly lines: readonly PurchaseOrderLineView[];
}

/** The outcome of creating a purchase order: the row plus replay status. */
export interface PurchaseOrderWriteResult {
  readonly order: PurchaseOrderView;
  readonly replayed: boolean;
}

/** One line of an atomic receipt. */
export interface PurchaseOrderReceiptLineView {
  readonly id: string;
  readonly poLineId: string;
  readonly quantity: number;
}

/** An atomic receipt against a purchase order. */
export interface PurchaseOrderReceiptView {
  readonly id: string;
  readonly poId: string;
  readonly warehouseId: string;
  readonly receivedAt: string;
  readonly lines: readonly PurchaseOrderReceiptLineView[];
}

/**
 * The full outcome of an atomic receipt: the durable receipt row, the
 * resulting purchase order (status possibly advanced), and whether this was
 * an idempotent **replay** of an earlier request. A replay moved no stock, so
 * the service audits and emits nothing for it.
 */
export interface PurchaseOrderReceiptResult {
  readonly receipt: PurchaseOrderReceiptView;
  readonly order: PurchaseOrderView;
  readonly replayed: boolean;
}

/** A (partial) payment against a purchase order. */
export interface PurchaseOrderPaymentView {
  readonly id: string;
  readonly poId: string;
  readonly amountMinor: number;
  readonly method: string;
  readonly paidAt: string;
}

/** The outcome of recording a payment: the row plus replay status. */
export interface PurchaseOrderPaymentResult {
  readonly payment: PurchaseOrderPaymentView;
  readonly replayed: boolean;
}

// ---- Expenses (M13.3) -------------------------------------------------------

/** A unified, categorized, dated money-out record. */
export interface ExpenseView {
  readonly id: string;
  readonly category: string;
  readonly amountMinor: number;
  readonly incurredAt: string;
  readonly notes: string | null;
  readonly supplierId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The outcome of creating an expense: the row plus replay status. */
export interface ExpenseWriteResult {
  readonly expense: ExpenseView;
  readonly replayed: boolean;
}

// ---- Tax settings (M13.3, D3) ------------------------------------------------

/** The company's one configured VAT rate + registration number. */
export interface TaxSettingsView {
  readonly companyId: string;
  readonly vatRateBps: number;
  readonly vatRegistrationNumber: string | null;
  readonly updatedAt: string;
}

// ---- Invoices (M13.4) --------------------------------------------------------

/** A line item on an invoice (append-only). */
export interface InvoiceLineView {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
}

/** An invoice without its lines (list rendering). */
export interface InvoiceListView {
  readonly id: string;
  readonly number: number;
  readonly orderId: string | null;
  readonly subtotalMinor: number;
  readonly vatMinor: number;
  readonly totalMinor: number;
  readonly vatRateBpsSnapshot: number;
  readonly pdfGeneratedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** An invoice with its lines (detail rendering). */
export interface InvoiceView extends InvoiceListView {
  readonly lines: readonly InvoiceLineView[];
}

/** The outcome of issuing an invoice: the row plus replay status. */
export interface InvoiceWriteResult {
  readonly invoice: InvoiceView;
  readonly replayed: boolean;
}

/** Everything the PDF renderer needs to draw one invoice, gathered read-only. */
export interface InvoicePdfData {
  readonly invoice: InvoiceView;
  readonly companyName: string | null;
  readonly vatRegistrationNumber: string | null;
  /** The order's customer name, when the invoice is order-based. */
  readonly billToName: string | null;
}

// ---- Refunds (M13.4) ---------------------------------------------------------

/** Money out against a prior invoice and/or order. `Idempotency-Key` is mandatory. */
export interface RefundView {
  readonly id: string;
  readonly invoiceId: string | null;
  readonly orderId: string | null;
  readonly amountMinor: number;
  readonly reason: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The outcome of issuing a refund: the row plus replay status. */
export interface RefundWriteResult {
  readonly refund: RefundView;
  readonly replayed: boolean;
}

// ---- Shipping reconciliation (M13.5, D5) --------------------------------------

/** One matched line of a reconciliation: a shipment's statement amount vs. its recorded fee. */
export interface ReconciliationLineView {
  readonly id: string;
  readonly shipmentId: string;
  readonly statementAmountMinor: number;
  readonly shipmentFeeMinor: number;
  readonly varianceMinor: number;
}

/** A reconciled carrier statement batch without its lines (list rendering). */
export interface ReconciliationListView {
  readonly id: string;
  readonly carrier: string;
  readonly statementRef: string;
  readonly periodKey: string;
  readonly totalStatementMinor: number;
  readonly totalFeeMinor: number;
  readonly totalVarianceMinor: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A reconciliation with its matched lines (detail rendering). */
export interface ReconciliationView extends ReconciliationListView {
  readonly lines: readonly ReconciliationLineView[];
}

/** The outcome of creating a reconciliation: the row plus replay status. */
export interface ReconciliationWriteResult {
  readonly reconciliation: ReconciliationView;
  readonly replayed: boolean;
}

// ---- Accounting periods (M13.5, D4) --------------------------------------------

/** The closed set of accounting-period statuses (mirrors the DB CHECK). */
export const ACCOUNTING_PERIOD_STATUSES = ["open", "closed"] as const;

/** An accounting-period status. */
export type AccountingPeriodStatus = (typeof ACCOUNTING_PERIOD_STATUSES)[number];

/** A monthly accounting period (`YYYY-MM`), open or closed. */
export interface AccountingPeriodView {
  readonly id: string;
  readonly periodKey: string;
  readonly status: AccountingPeriodStatus;
  readonly closedAt: string | null;
  readonly closedBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The outcome of closing a period: the row plus replay status (already-closed replay). */
export interface PeriodCloseResult {
  readonly period: AccountingPeriodView;
  readonly replayed: boolean;
}

// ---- Cash center + P&L (M13.5, D6 — computed reads) ----------------------------

/** A computed, read-only cash-center summary over a date range. */
export interface CashCenterReportView {
  readonly collectedMinor: number;
  readonly expensesMinor: number;
  readonly purchaseOrderPaymentsMinor: number;
  readonly refundsMinor: number;
  readonly shippingFeesMinor: number;
  readonly netCashMinor: number;
}

/** A computed P&L summary over one date range. */
export interface PnlPeriodView {
  readonly revenueMinor: number;
  readonly cogsMinor: number;
  readonly expensesMinor: number;
  readonly netIncomeMinor: number;
}

/** A computed P&L report, optionally with a comparison period. */
export interface PnlReportView {
  readonly current: PnlPeriodView;
  readonly previous?: PnlPeriodView;
}
