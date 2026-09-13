import { apiFetch } from "@/lib/api-client";
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

/** Totals for one window of the expense summary. */
export interface ExpensePeriodTotals {
  readonly totalMinor: number;
  readonly count: number;
  /** Over the months elapsed in the year. */
  readonly averageMonthlyMinor: number;
}

/** A calendar year's expense statistics (Africa/Cairo). */
export interface ExpenseSummary {
  readonly year: number;
  readonly monthsElapsed: number;
  readonly current: ExpensePeriodTotals;
  /** The same span one year earlier. */
  readonly previous: ExpensePeriodTotals;
  /** Twelve entries, January first. */
  readonly monthly: readonly { readonly month: number; readonly totalMinor: number }[];
  /** Largest total first. */
  readonly byCategory: readonly {
    readonly category: string;
    readonly totalMinor: number;
    readonly count: number;
  }[];
}

/** `GET /v1/finance/expenses/summary` — defaults to the current year. */
export function getExpenseSummary(year?: number): Promise<ExpenseSummary> {
  return apiFetch<ExpenseSummary>(`/finance/expenses/summary${buildQuery({ year })}`);
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
