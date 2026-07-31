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
