import type { KeysetPage } from "@cadeau/database";
import type {
  ExpenseView,
  ExpenseWriteResult,
  PurchaseOrderListView,
  PurchaseOrderPaymentResult,
  PurchaseOrderReceiptResult,
  PurchaseOrderView,
  PurchaseOrderWriteResult,
  SupplierView,
  TaxSettingsView,
} from "./finance.entity";
import type {
  ParsedExpenseListQuery,
  ParsedPurchaseOrderListQuery,
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
}

/** DI token for {@link FinanceRepositoryPort}. */
export const FINANCE_REPOSITORY = Symbol("FINANCE_REPOSITORY");
