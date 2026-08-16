import { apiFetch, apiFetchBlob } from "@/lib/api-client";
import { buildQuery } from "@/lib/build-query";

/** A keyset page (api-conventions §5). */
export interface Page<T> {
  readonly data: T[];
  readonly page: {
    readonly limit: number;
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

/** A fresh idempotency key for a money-moving create (crypto.randomUUID, RFC 4122). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function idempotencyOptions(key?: string): { headers: Record<string, string> } | object {
  return key === undefined ? {} : { headers: { "Idempotency-Key": key } };
}

// ---- Suppliers ----------------------------------------------------------------

/** A goods/services supplier. */
export interface Supplier {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly taxId: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Create/update supplier body. Send `null` to clear an optional field. */
export interface SupplierInput {
  readonly name?: string;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly address?: string | null;
  readonly taxId?: string | null;
  readonly active?: boolean;
}

export interface SupplierListOptions {
  readonly cursor?: string;
  readonly active?: boolean | "all";
  readonly q?: string;
}

/** `GET /v1/finance/suppliers` */
export function listSuppliers(options: SupplierListOptions = {}): Promise<Page<Supplier>> {
  return apiFetch<Page<Supplier>>(
    `/finance/suppliers${buildQuery({
      cursor: options.cursor,
      active: options.active === undefined ? undefined : String(options.active),
      q: options.q,
    })}`,
  );
}

/** `GET /v1/finance/suppliers/{id}` */
export function getSupplier(id: string): Promise<Supplier> {
  return apiFetch<Supplier>(`/finance/suppliers/${id}`);
}

/** `POST /v1/finance/suppliers` */
export function createSupplier(body: SupplierInput): Promise<Supplier> {
  return apiFetch<Supplier>("/finance/suppliers", { method: "POST", body });
}

/** `PATCH /v1/finance/suppliers/{id}` */
export function updateSupplier(id: string, body: SupplierInput): Promise<Supplier> {
  return apiFetch<Supplier>(`/finance/suppliers/${id}`, { method: "PATCH", body });
}

/** `DELETE /v1/finance/suppliers/{id}` — archive (soft-delete). */
export function archiveSupplier(id: string): Promise<void> {
  return apiFetch<void>(`/finance/suppliers/${id}`, { method: "DELETE" });
}

// ---- Purchase orders ------------------------------------------------------------

export const PURCHASE_ORDER_STATUSES = [
  "draft",
  "ordered",
  "partially_received",
  "received",
  "cancelled",
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export interface PurchaseOrderLine {
  readonly id: string;
  readonly variantId: string;
  readonly quantityOrdered: number;
  readonly quantityReceived: number;
  readonly unitCost: number;
}

export interface PurchaseOrderListItem {
  readonly id: string;
  readonly number: number;
  readonly supplierId: string;
  readonly status: PurchaseOrderStatus;
  readonly expectedDate: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PurchaseOrderDetail extends PurchaseOrderListItem {
  readonly lines: PurchaseOrderLine[];
}

export interface CreatePurchaseOrderLineInput {
  readonly variantId: string;
  readonly quantityOrdered: number;
  readonly unitCost: number;
}

export interface CreatePurchaseOrderInput {
  readonly supplierId: string;
  readonly expectedDate?: string | null;
  readonly notes?: string | null;
  readonly lines: CreatePurchaseOrderLineInput[];
}

export interface PurchaseOrderReceiptLineResult {
  readonly id: string;
  readonly poLineId: string;
  readonly quantity: number;
}

export interface PurchaseOrderReceipt {
  readonly id: string;
  readonly poId: string;
  readonly warehouseId: string;
  readonly receivedAt: string;
  readonly lines: PurchaseOrderReceiptLineResult[];
}

export interface PurchaseOrderPayment {
  readonly id: string;
  readonly poId: string;
  readonly amountMinor: number;
  readonly method: string;
  readonly paidAt: string;
}

export interface PurchaseOrderListOptions {
  readonly cursor?: string;
  readonly status?: PurchaseOrderStatus;
  readonly supplierId?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

/** `GET /v1/finance/purchase-orders` */
export function listPurchaseOrders(
  options: PurchaseOrderListOptions = {},
): Promise<Page<PurchaseOrderListItem>> {
  return apiFetch<Page<PurchaseOrderListItem>>(
    `/finance/purchase-orders${buildQuery({
      cursor: options.cursor,
      status: options.status,
      supplierId: options.supplierId,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
    })}`,
  );
}

/** `GET /v1/finance/purchase-orders/{id}` */
export function getPurchaseOrder(id: string): Promise<PurchaseOrderDetail> {
  return apiFetch<PurchaseOrderDetail>(`/finance/purchase-orders/${id}`);
}

/** `POST /v1/finance/purchase-orders` — optionally idempotency-keyed. */
export function createPurchaseOrder(
  body: CreatePurchaseOrderInput,
  idempotencyKey?: string,
): Promise<PurchaseOrderDetail> {
  return apiFetch<PurchaseOrderDetail>("/finance/purchase-orders", {
    method: "POST",
    body,
    ...idempotencyOptions(idempotencyKey),
  });
}

/** `POST /v1/finance/purchase-orders/{id}/receipts` — atomic (stock + averageCost). */
export function receivePurchaseOrder(
  poId: string,
  body: {
    warehouseId: string;
    receivedAt?: string;
    lines: { poLineId: string; quantity: number }[];
  },
  idempotencyKey?: string,
): Promise<PurchaseOrderReceipt> {
  return apiFetch<PurchaseOrderReceipt>(`/finance/purchase-orders/${poId}/receipts`, {
    method: "POST",
    body,
    ...idempotencyOptions(idempotencyKey),
  });
}

/** `POST /v1/finance/purchase-orders/{id}/payments` */
export function payPurchaseOrder(
  poId: string,
  body: { amountMinor: number; method: string; paidAt?: string },
  idempotencyKey?: string,
): Promise<PurchaseOrderPayment> {
  return apiFetch<PurchaseOrderPayment>(`/finance/purchase-orders/${poId}/payments`, {
    method: "POST",
    body,
    ...idempotencyOptions(idempotencyKey),
  });
}

// ---- Expenses -------------------------------------------------------------------

export interface Expense {
  readonly id: string;
  readonly category: string;
  readonly amountMinor: number;
  readonly incurredAt: string;
  readonly notes: string | null;
  readonly supplierId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExpenseInput {
  readonly category?: string;
  readonly amountMinor?: number;
  readonly incurredAt?: string;
  readonly notes?: string | null;
  readonly supplierId?: string | null;
}

export interface ExpenseListOptions {
  readonly cursor?: string;
  readonly category?: string;
  readonly supplierId?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

/** `GET /v1/finance/expenses` */
export function listExpenses(options: ExpenseListOptions = {}): Promise<Page<Expense>> {
  return apiFetch<Page<Expense>>(
    `/finance/expenses${buildQuery({
      cursor: options.cursor,
      category: options.category,
      supplierId: options.supplierId,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
    })}`,
  );
}

/** `POST /v1/finance/expenses` — optionally idempotency-keyed. */
export function createExpense(
  body: {
    category: string;
    amountMinor: number;
    incurredAt: string;
    notes?: string | null;
    supplierId?: string | null;
  },
  idempotencyKey?: string,
): Promise<Expense> {
  return apiFetch<Expense>("/finance/expenses", {
    method: "POST",
    body,
    ...idempotencyOptions(idempotencyKey),
  });
}

/** `PATCH /v1/finance/expenses/{id}` */
export function updateExpense(id: string, body: ExpenseInput): Promise<Expense> {
  return apiFetch<Expense>(`/finance/expenses/${id}`, { method: "PATCH", body });
}

// ---- Tax settings -----------------------------------------------------------------

export interface TaxSettings {
  readonly companyId: string;
  readonly vatRateBps: number;
  readonly vatRegistrationNumber: string | null;
  readonly updatedAt: string;
}

/** `GET /v1/finance/tax-settings` */
export function getTaxSettings(): Promise<TaxSettings> {
  return apiFetch<TaxSettings>("/finance/tax-settings");
}

/** `PATCH /v1/finance/tax-settings` */
export function updateTaxSettings(body: {
  vatRateBps?: number;
  vatRegistrationNumber?: string | null;
}): Promise<TaxSettings> {
  return apiFetch<TaxSettings>("/finance/tax-settings", { method: "PATCH", body });
}

// ---- Invoices ----------------------------------------------------------------

export interface InvoiceLine {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
}

export interface InvoiceListItem {
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

export interface InvoiceDetail extends InvoiceListItem {
  readonly lines: InvoiceLine[];
}

export interface CreateInvoiceLineInput {
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
}

export interface CreateInvoiceInput {
  readonly orderId?: string;
  readonly lines?: CreateInvoiceLineInput[];
}

export interface InvoiceListOptions {
  readonly cursor?: string;
  readonly orderId?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

/** `GET /v1/finance/invoices` */
export function listInvoices(options: InvoiceListOptions = {}): Promise<Page<InvoiceListItem>> {
  return apiFetch<Page<InvoiceListItem>>(
    `/finance/invoices${buildQuery({
      cursor: options.cursor,
      orderId: options.orderId,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
    })}`,
  );
}

/** `GET /v1/finance/invoices/{id}` */
export function getInvoice(id: string): Promise<InvoiceDetail> {
  return apiFetch<InvoiceDetail>(`/finance/invoices/${id}`);
}

/** `POST /v1/finance/invoices` — optionally idempotency-keyed. */
export function createInvoice(
  body: CreateInvoiceInput,
  idempotencyKey?: string,
): Promise<InvoiceDetail> {
  return apiFetch<InvoiceDetail>("/finance/invoices", {
    method: "POST",
    body,
    ...idempotencyOptions(idempotencyKey),
  });
}

/**
 * `GET /v1/finance/invoices/{id}/pdf` — fetches the PDF as a blob and triggers
 * a browser download via a transient object URL (no dedicated download utility
 * exists elsewhere in this codebase to reuse).
 */
export async function downloadInvoicePdf(id: string, invoiceNumber: number): Promise<void> {
  const blob = await apiFetchBlob(`/finance/invoices/${id}/pdf`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `invoice-${invoiceNumber}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- Refunds ------------------------------------------------------------------

export interface Refund {
  readonly id: string;
  readonly invoiceId: string | null;
  readonly orderId: string | null;
  readonly amountMinor: number;
  readonly reason: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateRefundInput {
  readonly invoiceId?: string;
  readonly orderId?: string;
  readonly amountMinor: number;
  readonly reason: string;
}

export interface RefundListOptions {
  readonly cursor?: string;
  readonly invoiceId?: string;
  readonly orderId?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

/** `GET /v1/finance/refunds` */
export function listRefunds(options: RefundListOptions = {}): Promise<Page<Refund>> {
  return apiFetch<Page<Refund>>(
    `/finance/refunds${buildQuery({
      cursor: options.cursor,
      invoiceId: options.invoiceId,
      orderId: options.orderId,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
    })}`,
  );
}

/** `POST /v1/finance/refunds` — `Idempotency-Key` is mandatory (contract §D2). */
export function createRefund(body: CreateRefundInput, idempotencyKey: string): Promise<Refund> {
  return apiFetch<Refund>("/finance/refunds", {
    method: "POST",
    body,
    ...idempotencyOptions(idempotencyKey),
  });
}

// ---- Shipping reconciliation --------------------------------------------------

export interface ReconciliationLine {
  readonly id: string;
  readonly shipmentId: string;
  readonly statementAmountMinor: number;
  readonly shipmentFeeMinor: number;
  readonly varianceMinor: number;
}

export interface ReconciliationListItem {
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

export interface ReconciliationDetail extends ReconciliationListItem {
  readonly lines: ReconciliationLine[];
}

export interface CreateReconciliationLineInput {
  readonly trackingNumber: string;
  readonly statementAmountMinor: number;
}

export interface CreateReconciliationInput {
  readonly carrier: string;
  readonly statementRef: string;
  readonly periodKey: string;
  readonly lines: CreateReconciliationLineInput[];
}

export interface ReconciliationListOptions {
  readonly cursor?: string;
  readonly carrier?: string;
  readonly periodKey?: string;
}

/** `GET /v1/finance/reconciliations` */
export function listReconciliations(
  options: ReconciliationListOptions = {},
): Promise<Page<ReconciliationListItem>> {
  return apiFetch<Page<ReconciliationListItem>>(
    `/finance/reconciliations${buildQuery({
      cursor: options.cursor,
      carrier: options.carrier,
      periodKey: options.periodKey,
    })}`,
  );
}

/** `GET /v1/finance/reconciliations/{id}` */
export function getReconciliation(id: string): Promise<ReconciliationDetail> {
  return apiFetch<ReconciliationDetail>(`/finance/reconciliations/${id}`);
}

/** `POST /v1/finance/reconciliations` — optionally idempotency-keyed. */
export function createReconciliation(
  body: CreateReconciliationInput,
  idempotencyKey?: string,
): Promise<ReconciliationDetail> {
  return apiFetch<ReconciliationDetail>("/finance/reconciliations", {
    method: "POST",
    body,
    ...idempotencyOptions(idempotencyKey),
  });
}

// ---- Accounting periods --------------------------------------------------------

export const ACCOUNTING_PERIOD_STATUSES = ["open", "closed"] as const;
export type AccountingPeriodStatus = (typeof ACCOUNTING_PERIOD_STATUSES)[number];

export interface AccountingPeriod {
  readonly id: string;
  readonly periodKey: string;
  readonly status: AccountingPeriodStatus;
  readonly closedAt: string | null;
  readonly closedBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `GET /v1/finance/periods` */
export function listPeriods(): Promise<AccountingPeriod[]> {
  return apiFetch<AccountingPeriod[]>("/finance/periods");
}

/** `POST /v1/finance/periods/{period}/close` — atomic, sequential (D4). */
export function closePeriod(period: string): Promise<AccountingPeriod> {
  return apiFetch<AccountingPeriod>(`/finance/periods/${period}/close`, { method: "POST" });
}

// ---- Reports (cash center / P&L) -----------------------------------------------

export interface CashCenterReport {
  readonly collectedMinor: number;
  readonly expensesMinor: number;
  readonly purchaseOrderPaymentsMinor: number;
  readonly refundsMinor: number;
  readonly shippingFeesMinor: number;
  readonly netCashMinor: number;
}

export interface PnlPeriod {
  readonly revenueMinor: number;
  readonly cogsMinor: number;
  readonly expensesMinor: number;
  readonly netIncomeMinor: number;
}

export interface PnlReport {
  readonly current: PnlPeriod;
  readonly previous?: PnlPeriod;
}

export interface ReportRange {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly compareFrom?: string;
  readonly compareTo?: string;
}

/** `GET /v1/finance/reports/cash-center` */
export function getCashCenterReport(range: ReportRange): Promise<CashCenterReport> {
  return apiFetch<CashCenterReport>(`/finance/reports/cash-center${buildQuery({ ...range })}`);
}

/** `GET /v1/finance/reports/pnl` */
export function getPnlReport(range: ReportRange): Promise<PnlReport> {
  return apiFetch<PnlReport>(`/finance/reports/pnl${buildQuery({ ...range })}`);
}
