import { Inject, Injectable } from "@nestjs/common";
import {
  buildKeysetPage,
  clampLimit,
  decodeCursor,
  InvalidCursorError,
  type KeysetPage,
  Prisma,
  type PrismaClient,
  setTenantContext,
  stampForCreate,
  stampForUpdate,
} from "@cadeau/database";
import type {
  CreateExpenseInput,
  CreateInvoiceInput,
  CreatePaymentInput,
  CreatePurchaseOrderInput,
  CreateReceiptInput,
  CreateReconciliationInput,
  CreateRefundInput,
  CreateSupplierInput,
  FinanceRepositoryPort,
  UpdateExpenseInput,
  UpdateSupplierInput,
  UpdateTaxSettingsInput,
  WriteActor,
} from "../domain/finance-repository.port";
import type {
  AccountingPeriodStatus,
  AccountingPeriodView,
  CashCenterReportView,
  ExpenseView,
  ExpenseWriteResult,
  InvoiceLineView,
  InvoiceListView,
  InvoicePdfData,
  InvoiceView,
  InvoiceWriteResult,
  PeriodCloseResult,
  PnlPeriodView,
  PnlReportView,
  PurchaseOrderListView,
  PurchaseOrderLineView,
  PurchaseOrderPaymentResult,
  PurchaseOrderPaymentView,
  PurchaseOrderReceiptResult,
  PurchaseOrderReceiptView,
  PurchaseOrderStatus,
  PurchaseOrderView,
  PurchaseOrderWriteResult,
  ReconciliationLineView,
  ReconciliationListView,
  ReconciliationView,
  ReconciliationWriteResult,
  RefundView,
  RefundWriteResult,
  SupplierView,
  TaxSettingsView,
} from "../domain/finance.entity";
import {
  EmptyInvoiceError,
  EmptyPurchaseOrderError,
  EmptyReconciliationError,
  IllegalPurchaseOrderStateError,
  InvalidAmountError,
  InvalidListCursorError,
  InvalidVatRateError,
  OverReceiptError,
  PeriodClosedError,
  PeriodSequenceGapError,
  ReferenceNotFoundError,
  ShipmentNotFoundForReconciliationError,
} from "../domain/finance.errors";
import type {
  ParsedExpenseListQuery,
  ParsedInvoiceListQuery,
  ParsedPurchaseOrderListQuery,
  ParsedReconciliationListQuery,
  ParsedRefundListQuery,
  ParsedSupplierListQuery,
} from "../domain/list-query";
import { computeVatMinor } from "../domain/vat";
import { FINANCE_PRISMA_CLIENT } from "./prisma-client.provider";

/** A Prisma client or transaction client. */
type Tx = Prisma.TransactionClient;

/** A decoded keyset cursor: primary sort value + id tie-breaker. */
interface DecodedCursor {
  readonly p: string;
  readonly t: string;
}

const SUPPLIER_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  address: true,
  taxId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const PO_LIST_SELECT = {
  id: true,
  number: true,
  supplierId: true,
  status: true,
  expectedDate: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} as const;

const PO_LINE_SELECT = {
  id: true,
  variantId: true,
  quantityOrdered: true,
  quantityReceived: true,
  unitCost: true,
} as const;

const PO_DETAIL_SELECT = {
  ...PO_LIST_SELECT,
  lines: { select: PO_LINE_SELECT, orderBy: { createdAt: "asc" as const } },
} as const;

const RECEIPT_LINE_SELECT = { id: true, poLineId: true, quantity: true } as const;

const RECEIPT_SELECT = {
  id: true,
  poId: true,
  warehouseId: true,
  receivedAt: true,
  lines: { select: RECEIPT_LINE_SELECT, orderBy: { createdAt: "asc" as const } },
} as const;

const PAYMENT_SELECT = {
  id: true,
  poId: true,
  amountMinor: true,
  method: true,
  paidAt: true,
} as const;

const EXPENSE_SELECT = {
  id: true,
  category: true,
  amountMinor: true,
  incurredAt: true,
  notes: true,
  supplierId: true,
  createdAt: true,
  updatedAt: true,
} as const;

const TAX_SETTINGS_SELECT = {
  companyId: true,
  vatRateBps: true,
  vatRegistrationNumber: true,
  updatedAt: true,
} as const;

const INVOICE_LINE_SELECT = {
  id: true,
  description: true,
  quantity: true,
  unitPriceMinor: true,
  lineTotalMinor: true,
} as const;

const INVOICE_LIST_SELECT = {
  id: true,
  number: true,
  orderId: true,
  subtotalMinor: true,
  vatMinor: true,
  totalMinor: true,
  vatRateBpsSnapshot: true,
  pdfGeneratedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const INVOICE_DETAIL_SELECT = {
  ...INVOICE_LIST_SELECT,
  lines: { select: INVOICE_LINE_SELECT, orderBy: { createdAt: "asc" as const } },
} as const;

const REFUND_SELECT = {
  id: true,
  invoiceId: true,
  orderId: true,
  amountMinor: true,
  reason: true,
  createdAt: true,
  updatedAt: true,
} as const;

const RECONCILIATION_LINE_SELECT = {
  id: true,
  shipmentId: true,
  statementAmountMinor: true,
  shipmentFeeMinor: true,
  varianceMinor: true,
} as const;

const RECONCILIATION_LIST_SELECT = {
  id: true,
  carrier: true,
  statementRef: true,
  periodKey: true,
  totalStatementMinor: true,
  totalFeeMinor: true,
  totalVarianceMinor: true,
  createdAt: true,
  updatedAt: true,
} as const;

const RECONCILIATION_DETAIL_SELECT = {
  ...RECONCILIATION_LIST_SELECT,
  lines: { select: RECONCILIATION_LINE_SELECT, orderBy: { createdAt: "asc" as const } },
} as const;

const PERIOD_SELECT = {
  id: true,
  periodKey: true,
  status: true,
  closedAt: true,
  closedBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PoListRow = Prisma.PurchaseOrderGetPayload<{ select: typeof PO_LIST_SELECT }>;
type PoDetailRow = Prisma.PurchaseOrderGetPayload<{ select: typeof PO_DETAIL_SELECT }>;
type ReceiptRow = Prisma.PurchaseOrderReceiptGetPayload<{ select: typeof RECEIPT_SELECT }>;
type ExpenseRow = Prisma.ExpenseGetPayload<{ select: typeof EXPENSE_SELECT }>;
type TaxSettingsRow = Prisma.TaxSettingsGetPayload<{ select: typeof TAX_SETTINGS_SELECT }>;
type InvoiceListRow = Prisma.InvoiceGetPayload<{ select: typeof INVOICE_LIST_SELECT }>;
type InvoiceDetailRow = Prisma.InvoiceGetPayload<{ select: typeof INVOICE_DETAIL_SELECT }>;
type RefundRow = Prisma.RefundGetPayload<{ select: typeof REFUND_SELECT }>;
type ReconciliationListRow = Prisma.ShippingReconciliationGetPayload<{
  select: typeof RECONCILIATION_LIST_SELECT;
}>;
type ReconciliationDetailRow = Prisma.ShippingReconciliationGetPayload<{
  select: typeof RECONCILIATION_DETAIL_SELECT;
}>;

/** A stock level row locked `FOR UPDATE` inside the current transaction. */
interface LockedStockLevel {
  readonly id: string;
  readonly onHand: bigint;
}

/** A locked purchase-order line row. */
interface LockedPoLine {
  readonly id: string;
  readonly variantId: string;
  readonly quantityOrdered: bigint;
  readonly quantityReceived: bigint;
  readonly unitCost: bigint;
}

/**
 * Prisma-backed finance repository (EPIC-13, M13.2 — suppliers + purchase
 * orders). Beyond CRUD it owns three atomic units of work, each inside a
 * single tenant transaction:
 *
 * 1. **Tenant isolation** — `setTenantContext` binds RLS for every unit of work.
 * 2. **PO-number issuance** — an atomic `INSERT … ON CONFLICT DO UPDATE …
 *    RETURNING` on `purchase_order_sequences`, same discipline as `order_sequences`.
 * 3. **Atomic receipt (D7)** — locks the PO's lines and the affected
 *    `inventory_stock`/`product_variants` rows (`SELECT … FOR UPDATE`, reusing
 *    the EPIC-9 discipline), raises `on_hand`, appends one `stock_adjustments`
 *    row per line (`reason = 'purchase_receipt'`), and rolls
 *    `product_variants.average_cost` by the moving-average formula, all before
 *    advancing the PO's `status`.
 *
 * **Idempotency.** Purchase-order creation, receipts, and payments each carry
 * an optional `Idempotency-Key` stored under a per-company unique index. A
 * retry finds the stored row and returns it as a `replayed` result.
 */
@Injectable()
export class FinanceRepository implements FinanceRepositoryPort {
  constructor(@Inject(FINANCE_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // ---- Suppliers ---------------------------------------------------------------

  async listSuppliers(
    companyId: string,
    query: ParsedSupplierListQuery,
  ): Promise<KeysetPage<SupplierView>> {
    const limit = clampLimit(query.limit);
    const cursor = this.decodeGeneric(query.sort.field, query.cursor);
    const where: Prisma.SupplierWhereInput = { companyId };
    if (query.active !== "all") where.isActive = query.active;
    if (query.q !== undefined) {
      where.OR = [
        { name: { contains: query.q, mode: "insensitive" } },
        { email: { contains: query.q, mode: "insensitive" } },
        { phone: { contains: query.q, mode: "insensitive" } },
      ];
    }
    if (cursor !== null) {
      where.AND = [this.stringKeysetPredicate(query.sort, cursor) as Prisma.SupplierWhereInput];
    }
    const rows = await this.tenantTx(companyId, (tx) =>
      tx.supplier.findMany({
        where,
        orderBy: [{ [query.sort.field]: query.sort.dir }, { id: query.sort.dir }],
        take: limit + 1,
        select: SUPPLIER_SELECT,
      }),
    );
    const views = rows.map((r) => this.toSupplierView(r));
    return buildKeysetPage(views, limit, (view) => ({
      p: query.sort.field === "createdAt" ? view.createdAt : view.name,
      t: view.id,
    }));
  }

  async findSupplier(companyId: string, id: string): Promise<SupplierView | null> {
    const row = await this.tenantTx(companyId, (tx) =>
      tx.supplier.findFirst({ where: { id, companyId }, select: SUPPLIER_SELECT }),
    );
    return row === null ? null : this.toSupplierView(row);
  }

  async createSupplier(actor: WriteActor, data: CreateSupplierInput): Promise<SupplierView> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const row = await tx.supplier.create({
        data: stampForCreate(actor, {
          name: data.name,
          phone: data.phone ?? null,
          email: data.email ?? null,
          address: data.address ?? null,
          taxId: data.taxId ?? null,
        }) as Prisma.SupplierUncheckedCreateInput,
        select: SUPPLIER_SELECT,
      });
      return this.toSupplierView(row);
    });
  }

  async updateSupplier(
    actor: WriteActor,
    id: string,
    data: UpdateSupplierInput,
  ): Promise<SupplierView | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const where = { id, companyId: actor.companyId };
      const patch: Record<string, unknown> = {};
      if (data.name !== undefined) patch["name"] = data.name;
      if (data.phone !== undefined) patch["phone"] = data.phone;
      if (data.email !== undefined) patch["email"] = data.email;
      if (data.address !== undefined) patch["address"] = data.address;
      if (data.taxId !== undefined) patch["taxId"] = data.taxId;
      if (data.active !== undefined) patch["isActive"] = data.active;
      const { count } = await tx.supplier.updateMany({
        where,
        data: stampForUpdate(actor, patch) as Prisma.SupplierUncheckedUpdateManyInput,
      });
      if (count === 0) return null;
      const row = await tx.supplier.findFirst({ where, select: SUPPLIER_SELECT });
      return row === null ? null : this.toSupplierView(row);
    });
  }

  async archiveSupplier(actor: WriteActor, id: string): Promise<SupplierView | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const where = { id, companyId: actor.companyId };
      const { count } = await tx.supplier.updateMany({
        where,
        data: stampForUpdate(actor, { isActive: false }) as Prisma.SupplierUncheckedUpdateManyInput,
      });
      if (count === 0) return null;
      const row = await tx.supplier.findFirst({ where, select: SUPPLIER_SELECT });
      return row === null ? null : this.toSupplierView(row);
    });
  }

  // ---- Purchase orders -----------------------------------------------------

  async listPurchaseOrders(
    companyId: string,
    query: ParsedPurchaseOrderListQuery,
  ): Promise<KeysetPage<PurchaseOrderListView>> {
    const limit = clampLimit(query.limit);
    const cursor = this.decodeGeneric("createdAt", query.cursor);
    const where: Prisma.PurchaseOrderWhereInput = { companyId };
    if (query.status !== undefined) where.status = query.status;
    if (query.supplierId !== undefined) where.supplierId = query.supplierId;
    if (query.dateFrom !== undefined || query.dateTo !== undefined) {
      where.createdAt = {
        ...(query.dateFrom !== undefined ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo !== undefined ? { lte: new Date(query.dateTo) } : {}),
      };
    }
    if (cursor !== null) {
      where.AND = [
        this.stringKeysetPredicate(query.sort, cursor) as Prisma.PurchaseOrderWhereInput,
      ];
    }
    const rows = await this.tenantTx(companyId, (tx) =>
      tx.purchaseOrder.findMany({
        where,
        orderBy: [{ [query.sort.field]: query.sort.dir }, { id: query.sort.dir }],
        take: limit + 1,
        select: PO_LIST_SELECT,
      }),
    );
    const views = rows.map((r) => this.toListView(r));
    return buildKeysetPage(views, limit, (view) => ({ p: view.createdAt, t: view.id }));
  }

  async findPurchaseOrder(companyId: string, id: string): Promise<PurchaseOrderView | null> {
    const row = await this.tenantTx(companyId, (tx) =>
      tx.purchaseOrder.findFirst({ where: { id, companyId }, select: PO_DETAIL_SELECT }),
    );
    return row === null ? null : this.toDetailView(row);
  }

  async createPurchaseOrder(
    actor: WriteActor,
    data: CreatePurchaseOrderInput,
  ): Promise<PurchaseOrderWriteResult> {
    if (data.lines.length === 0) throw new EmptyPurchaseOrderError();
    return this.tenantTx(actor.companyId, async (tx) => {
      const replay = await this.findPoByIdempotencyKey(tx, actor.companyId, data.idempotencyKey);
      if (replay !== null) return { order: this.toDetailView(replay), replayed: true };

      await this.assertSupplier(tx, actor.companyId, data.supplierId);
      for (const line of data.lines) {
        if (line.quantityOrdered <= 0) throw new InvalidAmountError("quantityOrdered");
        if (line.unitCost < 0) throw new InvalidAmountError("unitCost");
        await this.assertVariant(tx, actor.companyId, line.variantId);
      }

      const number = await this.issuePoNumber(tx, actor.companyId);

      let poId: string;
      try {
        const po = await tx.purchaseOrder.create({
          data: stampForCreate(actor, {
            supplierId: data.supplierId,
            number,
            status: "ordered",
            expectedDate:
              data.expectedDate === undefined ? null : this.toDateOrNull(data.expectedDate),
            notes: data.notes ?? null,
            idempotencyKey: data.idempotencyKey ?? null,
          }) as Prisma.PurchaseOrderUncheckedCreateInput,
          select: { id: true },
        });
        poId = po.id;
        for (const line of data.lines) {
          await tx.purchaseOrderLine.create({
            data: stampForCreate(actor, {
              poId,
              variantId: line.variantId,
              quantityOrdered: BigInt(line.quantityOrdered),
              unitCost: BigInt(line.unitCost),
            }) as Prisma.PurchaseOrderLineUncheckedCreateInput,
          });
        }
      } catch (error) {
        const raced = await this.replayOnKeyConflict(
          tx,
          actor.companyId,
          data.idempotencyKey,
          error,
          (key) => this.findPoByIdempotencyKey(tx, actor.companyId, key),
        );
        if (raced !== null) return { order: this.toDetailView(raced), replayed: true };
        throw error;
      }

      const full = await tx.purchaseOrder.findFirstOrThrow({
        where: { id: poId },
        select: PO_DETAIL_SELECT,
      });
      return { order: this.toDetailView(full), replayed: false };
    });
  }

  async receivePurchaseOrder(
    actor: WriteActor,
    poId: string,
    data: CreateReceiptInput,
  ): Promise<PurchaseOrderReceiptResult | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const replay = await this.findReceiptByIdempotencyKey(
        tx,
        actor.companyId,
        data.idempotencyKey,
      );
      if (replay !== null) {
        const order = await tx.purchaseOrder.findFirst({
          where: { id: replay.poId, companyId: actor.companyId },
          select: PO_DETAIL_SELECT,
        });
        if (order === null) return null;
        return {
          receipt: this.toReceiptView(replay),
          order: this.toDetailView(order),
          replayed: true,
        };
      }

      if (data.lines.length === 0)
        throw new EmptyPurchaseOrderError("A receipt must have at least one line.");

      // Lock the PO header, then all of its lines, so concurrent receipts on
      // the same PO serialize before either reads a quantity balance.
      const poLocked = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status
          FROM public.purchase_orders
         WHERE id = ${poId}::uuid AND company_id = ${actor.companyId}::uuid
         FOR UPDATE`;
      const poRow = poLocked[0];
      if (poRow === undefined) return null;
      if (poRow.status === "cancelled" || poRow.status === "received") {
        throw new IllegalPurchaseOrderStateError(poRow.status);
      }

      const lineRows = await tx.$queryRaw<
        {
          id: string;
          variant_id: string;
          quantity_ordered: bigint;
          quantity_received: bigint;
          unit_cost: bigint;
        }[]
      >`SELECT id, variant_id, quantity_ordered, quantity_received, unit_cost
          FROM public.purchase_order_lines
         WHERE po_id = ${poId}::uuid AND company_id = ${actor.companyId}::uuid
         FOR UPDATE`;
      const linesById = new Map<string, LockedPoLine>(
        lineRows.map((r) => [
          r.id,
          {
            id: r.id,
            variantId: r.variant_id,
            quantityOrdered: r.quantity_ordered,
            quantityReceived: r.quantity_received,
            unitCost: r.unit_cost,
          },
        ]),
      );

      // Validate every requested line before writing anything.
      const resolved: { line: LockedPoLine; quantity: bigint }[] = [];
      for (const input of data.lines) {
        if (input.quantity <= 0) throw new InvalidAmountError("quantity");
        const line = linesById.get(input.poLineId);
        if (line === undefined) throw new ReferenceNotFoundError("poLineId");
        const remaining = line.quantityOrdered - line.quantityReceived;
        const quantity = BigInt(input.quantity);
        if (quantity > remaining) {
          throw new OverReceiptError(line.id, input.quantity, Number(remaining));
        }
        resolved.push({ line, quantity });
      }

      await this.assertWarehouse(tx, actor.companyId, data.warehouseId);

      let receiptId: string;
      try {
        const receipt = await tx.purchaseOrderReceipt.create({
          data: stampForCreate(actor, {
            poId,
            warehouseId: data.warehouseId,
            receivedAt: data.receivedAt === undefined ? new Date() : new Date(data.receivedAt),
            idempotencyKey: data.idempotencyKey ?? null,
          }) as Prisma.PurchaseOrderReceiptUncheckedCreateInput,
          select: { id: true },
        });
        receiptId = receipt.id;

        // Deterministic order (by variantId) so two receipts touching an
        // overlapping variant set cannot deadlock on the variant/stock locks.
        const ordered = [...resolved].sort((a, b) =>
          a.line.variantId.localeCompare(b.line.variantId),
        );
        for (const { line, quantity } of ordered) {
          await tx.purchaseOrderReceiptLine.create({
            data: {
              companyId: actor.companyId,
              receiptId,
              poLineId: line.id,
              quantity,
            } as Prisma.PurchaseOrderReceiptLineUncheckedCreateInput,
          });
          await tx.purchaseOrderLine.updateMany({
            where: { id: line.id, companyId: actor.companyId },
            data: stampForUpdate(actor, {
              quantityReceived: { increment: quantity },
            }) as Prisma.PurchaseOrderLineUncheckedUpdateManyInput,
          });
          await this.applyReceiptToStock(tx, actor, data.warehouseId, line, quantity);
        }
      } catch (error) {
        const raced = await this.replayOnKeyConflict(
          tx,
          actor.companyId,
          data.idempotencyKey,
          error,
          (key) => this.findReceiptByIdempotencyKey(tx, actor.companyId, key),
        );
        if (raced !== null) {
          const order = await tx.purchaseOrder.findFirst({
            where: { id: raced.poId, companyId: actor.companyId },
            select: PO_DETAIL_SELECT,
          });
          if (order === null) return null;
          return {
            receipt: this.toReceiptView(raced),
            order: this.toDetailView(order),
            replayed: true,
          };
        }
        throw error;
      }

      // Advance PO status: 'received' once every line is fully received,
      // otherwise 'partially_received' (a receipt just happened).
      const freshLines = await tx.purchaseOrderLine.findMany({
        where: { poId, companyId: actor.companyId },
        select: { quantityOrdered: true, quantityReceived: true },
      });
      const allReceived = freshLines.every((l) => l.quantityReceived >= l.quantityOrdered);
      await tx.purchaseOrder.updateMany({
        where: { id: poId, companyId: actor.companyId },
        data: stampForUpdate(actor, {
          status: allReceived ? "received" : "partially_received",
        }) as Prisma.PurchaseOrderUncheckedUpdateManyInput,
      });

      const receiptRow = await tx.purchaseOrderReceipt.findFirstOrThrow({
        where: { id: receiptId },
        select: RECEIPT_SELECT,
      });
      const orderRow = await tx.purchaseOrder.findFirstOrThrow({
        where: { id: poId },
        select: PO_DETAIL_SELECT,
      });
      return {
        receipt: this.toReceiptView(receiptRow),
        order: this.toDetailView(orderRow),
        replayed: false,
      };
    });
  }

  async payPurchaseOrder(
    actor: WriteActor,
    poId: string,
    data: CreatePaymentInput,
  ): Promise<PurchaseOrderPaymentResult | null> {
    if (data.amountMinor <= 0) throw new InvalidAmountError("amountMinor");
    return this.tenantTx(actor.companyId, async (tx) => {
      const replay = await this.findPaymentByIdempotencyKey(
        tx,
        actor.companyId,
        data.idempotencyKey,
      );
      if (replay !== null) return { payment: this.toPaymentView(replay), replayed: true };

      const po = await tx.purchaseOrder.findFirst({
        where: { id: poId, companyId: actor.companyId },
        select: { id: true },
      });
      if (po === null) return null;

      let row;
      try {
        row = await tx.purchaseOrderPayment.create({
          data: stampForCreate(actor, {
            poId,
            amountMinor: BigInt(data.amountMinor),
            method: data.method,
            paidAt: data.paidAt === undefined ? new Date() : new Date(data.paidAt),
            idempotencyKey: data.idempotencyKey ?? null,
          }) as Prisma.PurchaseOrderPaymentUncheckedCreateInput,
          select: PAYMENT_SELECT,
        });
      } catch (error) {
        const raced = await this.replayOnKeyConflict(
          tx,
          actor.companyId,
          data.idempotencyKey,
          error,
          (key) => this.findPaymentByIdempotencyKey(tx, actor.companyId, key),
        );
        if (raced !== null) return { payment: this.toPaymentView(raced), replayed: true };
        throw error;
      }
      return { payment: this.toPaymentView(row), replayed: false };
    });
  }

  // ---- Expenses (M13.3) --------------------------------------------------------

  async listExpenses(
    companyId: string,
    query: ParsedExpenseListQuery,
  ): Promise<KeysetPage<ExpenseView>> {
    const limit = clampLimit(query.limit);
    const cursor = this.decodeGeneric("incurredAt", query.cursor);
    const where: Prisma.ExpenseWhereInput = { companyId };
    if (query.category !== undefined) where.category = query.category;
    if (query.supplierId !== undefined) where.supplierId = query.supplierId;
    if (query.dateFrom !== undefined || query.dateTo !== undefined) {
      where.incurredAt = {
        ...(query.dateFrom !== undefined ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo !== undefined ? { lte: new Date(query.dateTo) } : {}),
      };
    }
    if (cursor !== null) {
      where.AND = [this.stringKeysetPredicate(query.sort, cursor) as Prisma.ExpenseWhereInput];
    }
    const rows = await this.tenantTx(companyId, (tx) =>
      tx.expense.findMany({
        where,
        orderBy: [{ [query.sort.field]: query.sort.dir }, { id: query.sort.dir }],
        take: limit + 1,
        select: EXPENSE_SELECT,
      }),
    );
    const views = rows.map((r) => this.toExpenseView(r));
    return buildKeysetPage(views, limit, (view) => ({ p: view.incurredAt, t: view.id }));
  }

  async findExpense(companyId: string, id: string): Promise<ExpenseView | null> {
    const row = await this.tenantTx(companyId, (tx) =>
      tx.expense.findFirst({ where: { id, companyId }, select: EXPENSE_SELECT }),
    );
    return row === null ? null : this.toExpenseView(row);
  }

  async createExpense(actor: WriteActor, data: CreateExpenseInput): Promise<ExpenseWriteResult> {
    if (data.amountMinor <= 0) throw new InvalidAmountError("amountMinor");
    return this.tenantTx(actor.companyId, async (tx) => {
      const replay = await this.findExpenseByIdempotencyKey(
        tx,
        actor.companyId,
        data.idempotencyKey,
      );
      if (replay !== null) return { expense: this.toExpenseView(replay), replayed: true };

      const incurredAt = new Date(data.incurredAt);
      await this.assertPeriodOpen(tx, actor.companyId, incurredAt);
      if (data.supplierId !== undefined && data.supplierId !== null) {
        await this.assertSupplier(tx, actor.companyId, data.supplierId);
      }

      let row: ExpenseRow;
      try {
        row = await tx.expense.create({
          data: stampForCreate(actor, {
            category: data.category,
            amountMinor: BigInt(data.amountMinor),
            incurredAt,
            notes: data.notes ?? null,
            supplierId: data.supplierId ?? null,
            idempotencyKey: data.idempotencyKey ?? null,
          }) as Prisma.ExpenseUncheckedCreateInput,
          select: EXPENSE_SELECT,
        });
      } catch (error) {
        const raced = await this.replayOnKeyConflict(
          tx,
          actor.companyId,
          data.idempotencyKey,
          error,
          (key) => this.findExpenseByIdempotencyKey(tx, actor.companyId, key),
        );
        if (raced !== null) return { expense: this.toExpenseView(raced), replayed: true };
        throw error;
      }
      return { expense: this.toExpenseView(row), replayed: false };
    });
  }

  async updateExpense(
    actor: WriteActor,
    id: string,
    data: UpdateExpenseInput,
  ): Promise<ExpenseView | null> {
    if (data.amountMinor !== undefined && data.amountMinor <= 0) {
      throw new InvalidAmountError("amountMinor");
    }
    return this.tenantTx(actor.companyId, async (tx) => {
      const where = { id, companyId: actor.companyId };
      const existing = await tx.expense.findFirst({ where, select: EXPENSE_SELECT });
      if (existing === null) return null;

      // The row's current date must not be inside a closed period (that is
      // the point of closing a period); a requested new date is checked too.
      await this.assertPeriodOpen(tx, actor.companyId, existing.incurredAt);

      const patch: Record<string, unknown> = {};
      if (data.category !== undefined) patch["category"] = data.category;
      if (data.amountMinor !== undefined) patch["amountMinor"] = BigInt(data.amountMinor);
      if (data.notes !== undefined) patch["notes"] = data.notes;
      if (data.supplierId !== undefined) {
        if (data.supplierId !== null)
          await this.assertSupplier(tx, actor.companyId, data.supplierId);
        patch["supplierId"] = data.supplierId;
      }
      if (data.incurredAt !== undefined) {
        const newIncurredAt = new Date(data.incurredAt);
        await this.assertPeriodOpen(tx, actor.companyId, newIncurredAt);
        patch["incurredAt"] = newIncurredAt;
      }

      const { count } = await tx.expense.updateMany({
        where,
        data: stampForUpdate(actor, patch) as Prisma.ExpenseUncheckedUpdateManyInput,
      });
      if (count === 0) return null;
      const row = await tx.expense.findFirst({ where, select: EXPENSE_SELECT });
      return row === null ? null : this.toExpenseView(row);
    });
  }

  // ---- Tax settings (M13.3, D3) ------------------------------------------------

  async getTaxSettings(companyId: string): Promise<TaxSettingsView> {
    return this.tenantTx(companyId, async (tx) => {
      const row = await tx.taxSettings.upsert({
        where: { companyId },
        create: { companyId, vatRateBps: 0, vatRegistrationNumber: null },
        update: {},
        select: TAX_SETTINGS_SELECT,
      });
      return this.toTaxSettingsView(row);
    });
  }

  async updateTaxSettings(
    actor: WriteActor,
    data: UpdateTaxSettingsInput,
  ): Promise<TaxSettingsView> {
    if (data.vatRateBps !== undefined && (data.vatRateBps < 0 || data.vatRateBps > 10000)) {
      throw new InvalidVatRateError();
    }
    return this.tenantTx(actor.companyId, async (tx) => {
      const patch: Record<string, unknown> = { updatedBy: actor.actorId };
      if (data.vatRateBps !== undefined) patch["vatRateBps"] = data.vatRateBps;
      if (data.vatRegistrationNumber !== undefined) {
        patch["vatRegistrationNumber"] = data.vatRegistrationNumber;
      }
      const row = await tx.taxSettings.upsert({
        where: { companyId: actor.companyId },
        create: {
          companyId: actor.companyId,
          vatRateBps: data.vatRateBps ?? 0,
          vatRegistrationNumber: data.vatRegistrationNumber ?? null,
          updatedBy: actor.actorId,
        },
        update: patch,
        select: TAX_SETTINGS_SELECT,
      });
      return this.toTaxSettingsView(row);
    });
  }

  // ---- Invoices (M13.4) --------------------------------------------------------

  async listInvoices(
    companyId: string,
    query: ParsedInvoiceListQuery,
  ): Promise<KeysetPage<InvoiceListView>> {
    const limit = clampLimit(query.limit);
    const cursor = this.decodeGeneric("createdAt", query.cursor);
    const where: Prisma.InvoiceWhereInput = { companyId };
    if (query.orderId !== undefined) where.orderId = query.orderId;
    if (query.dateFrom !== undefined || query.dateTo !== undefined) {
      where.createdAt = {
        ...(query.dateFrom !== undefined ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo !== undefined ? { lte: new Date(query.dateTo) } : {}),
      };
    }
    if (cursor !== null) {
      where.AND = [this.stringKeysetPredicate(query.sort, cursor) as Prisma.InvoiceWhereInput];
    }
    const rows = await this.tenantTx(companyId, (tx) =>
      tx.invoice.findMany({
        where,
        orderBy: [{ [query.sort.field]: query.sort.dir }, { id: query.sort.dir }],
        take: limit + 1,
        select: INVOICE_LIST_SELECT,
      }),
    );
    const views = rows.map((r) => this.toInvoiceListView(r));
    return buildKeysetPage(views, limit, (view) => ({ p: view.createdAt, t: view.id }));
  }

  async findInvoice(companyId: string, id: string): Promise<InvoiceView | null> {
    const row = await this.tenantTx(companyId, (tx) =>
      tx.invoice.findFirst({ where: { id, companyId }, select: INVOICE_DETAIL_SELECT }),
    );
    return row === null ? null : this.toInvoiceDetailView(row);
  }

  async createInvoice(actor: WriteActor, data: CreateInvoiceInput): Promise<InvoiceWriteResult> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const replay = await this.findInvoiceByIdempotencyKey(
        tx,
        actor.companyId,
        data.idempotencyKey,
      );
      if (replay !== null) return { invoice: this.toInvoiceDetailView(replay), replayed: true };

      await this.assertPeriodOpen(tx, actor.companyId, new Date());

      let orderId: string | null = null;
      let resolvedLines: { description: string; quantity: bigint; unitPriceMinor: bigint }[];

      if (data.orderId !== undefined) {
        orderId = data.orderId;
        const order = await tx.order.findFirst({
          where: { id: data.orderId, companyId: actor.companyId },
          select: {
            id: true,
            items: { select: { nameSnapshot: true, quantity: true, price: true } },
          },
        });
        if (order === null) throw new ReferenceNotFoundError("orderId");
        resolvedLines = order.items.map((item) => ({
          description: item.nameSnapshot,
          quantity: item.quantity,
          unitPriceMinor: item.price,
        }));
      } else {
        const manualLines = data.lines ?? [];
        for (const line of manualLines) {
          if (line.quantity <= 0) throw new InvalidAmountError("quantity");
          if (line.unitPriceMinor < 0) throw new InvalidAmountError("unitPriceMinor");
        }
        resolvedLines = manualLines.map((line) => ({
          description: line.description,
          quantity: BigInt(line.quantity),
          unitPriceMinor: BigInt(line.unitPriceMinor),
        }));
      }
      if (resolvedLines.length === 0) throw new EmptyInvoiceError();

      const subtotalMinor = resolvedLines.reduce(
        (sum, line) => sum + line.quantity * line.unitPriceMinor,
        0n,
      );
      const vatRateBps = await this.getVatRateBps(tx, actor.companyId);
      const vatMinor = computeVatMinor(subtotalMinor, vatRateBps);
      const totalMinor = subtotalMinor + vatMinor;

      const number = await this.issueInvoiceNumber(tx, actor.companyId);

      let invoiceId: string;
      try {
        const invoice = await tx.invoice.create({
          data: stampForCreate(actor, {
            orderId,
            number,
            subtotalMinor,
            vatMinor,
            totalMinor,
            vatRateBpsSnapshot: vatRateBps,
            idempotencyKey: data.idempotencyKey ?? null,
          }) as Prisma.InvoiceUncheckedCreateInput,
          select: { id: true },
        });
        invoiceId = invoice.id;
        for (const line of resolvedLines) {
          await tx.invoiceLine.create({
            data: {
              companyId: actor.companyId,
              invoiceId,
              description: line.description,
              quantity: line.quantity,
              unitPriceMinor: line.unitPriceMinor,
              lineTotalMinor: line.quantity * line.unitPriceMinor,
            } as Prisma.InvoiceLineUncheckedCreateInput,
          });
        }
      } catch (error) {
        const raced = await this.replayOnKeyConflict(
          tx,
          actor.companyId,
          data.idempotencyKey,
          error,
          (key) => this.findInvoiceByIdempotencyKey(tx, actor.companyId, key),
        );
        if (raced !== null) return { invoice: this.toInvoiceDetailView(raced), replayed: true };
        throw error;
      }

      const full = await tx.invoice.findFirstOrThrow({
        where: { id: invoiceId },
        select: INVOICE_DETAIL_SELECT,
      });
      return { invoice: this.toInvoiceDetailView(full), replayed: false };
    });
  }

  async getInvoicePdfData(companyId: string, id: string): Promise<InvoicePdfData | null> {
    return this.tenantTx(companyId, async (tx) => {
      let row = await tx.invoice.findFirst({
        where: { id, companyId },
        select: INVOICE_DETAIL_SELECT,
      });
      if (row === null) return null;

      if (row.pdfGeneratedAt === null) {
        await tx.invoice.updateMany({
          where: { id, companyId, pdfGeneratedAt: null },
          data: { pdfGeneratedAt: new Date() },
        });
        row = await tx.invoice.findFirstOrThrow({
          where: { id, companyId },
          select: INVOICE_DETAIL_SELECT,
        });
      }

      const company = await tx.company.findFirst({
        where: { id: companyId },
        select: { name: true },
      });
      const taxSettings = await tx.taxSettings.findFirst({
        where: { companyId },
        select: { vatRegistrationNumber: true },
      });

      let billToName: string | null = null;
      if (row.orderId !== null) {
        const order = await tx.order.findFirst({
          where: { id: row.orderId, companyId },
          select: { customer: { select: { name: true } } },
        });
        billToName = order?.customer.name ?? null;
      }

      return {
        invoice: this.toInvoiceDetailView(row),
        companyName: company?.name ?? null,
        vatRegistrationNumber: taxSettings?.vatRegistrationNumber ?? null,
        billToName,
      };
    });
  }

  // ---- Refunds (M13.4) ---------------------------------------------------------

  async listRefunds(
    companyId: string,
    query: ParsedRefundListQuery,
  ): Promise<KeysetPage<RefundView>> {
    const limit = clampLimit(query.limit);
    const cursor = this.decodeGeneric("createdAt", query.cursor);
    const where: Prisma.RefundWhereInput = { companyId };
    if (query.invoiceId !== undefined) where.invoiceId = query.invoiceId;
    if (query.orderId !== undefined) where.orderId = query.orderId;
    if (query.dateFrom !== undefined || query.dateTo !== undefined) {
      where.createdAt = {
        ...(query.dateFrom !== undefined ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo !== undefined ? { lte: new Date(query.dateTo) } : {}),
      };
    }
    if (cursor !== null) {
      where.AND = [this.stringKeysetPredicate(query.sort, cursor) as Prisma.RefundWhereInput];
    }
    const rows = await this.tenantTx(companyId, (tx) =>
      tx.refund.findMany({
        where,
        orderBy: [{ [query.sort.field]: query.sort.dir }, { id: query.sort.dir }],
        take: limit + 1,
        select: REFUND_SELECT,
      }),
    );
    const views = rows.map((r) => this.toRefundView(r));
    return buildKeysetPage(views, limit, (view) => ({ p: view.createdAt, t: view.id }));
  }

  async createRefund(actor: WriteActor, data: CreateRefundInput): Promise<RefundWriteResult> {
    if (data.amountMinor <= 0) throw new InvalidAmountError("amountMinor");
    return this.tenantTx(actor.companyId, async (tx) => {
      const replay = await this.findRefundByIdempotencyKey(
        tx,
        actor.companyId,
        data.idempotencyKey,
      );
      if (replay !== null) return { refund: this.toRefundView(replay), replayed: true };

      await this.assertPeriodOpen(tx, actor.companyId, new Date());

      if (data.invoiceId !== undefined)
        await this.assertInvoice(tx, actor.companyId, data.invoiceId);
      if (data.orderId !== undefined) await this.assertOrderRef(tx, actor.companyId, data.orderId);

      let row: RefundRow;
      try {
        row = await tx.refund.create({
          data: stampForCreate(actor, {
            invoiceId: data.invoiceId ?? null,
            orderId: data.orderId ?? null,
            amountMinor: BigInt(data.amountMinor),
            reason: data.reason,
            idempotencyKey: data.idempotencyKey,
          }) as Prisma.RefundUncheckedCreateInput,
          select: REFUND_SELECT,
        });
      } catch (error) {
        const raced = await this.replayOnKeyConflict(
          tx,
          actor.companyId,
          data.idempotencyKey,
          error,
          (key) => this.findRefundByIdempotencyKey(tx, actor.companyId, key),
        );
        if (raced !== null) return { refund: this.toRefundView(raced), replayed: true };
        throw error;
      }
      return { refund: this.toRefundView(row), replayed: false };
    });
  }

  // ---- Shipping reconciliation (M13.5, D5) --------------------------------------

  async listReconciliations(
    companyId: string,
    query: ParsedReconciliationListQuery,
  ): Promise<KeysetPage<ReconciliationListView>> {
    const limit = clampLimit(query.limit);
    const cursor = this.decodeGeneric("createdAt", query.cursor);
    const where: Prisma.ShippingReconciliationWhereInput = { companyId };
    if (query.carrier !== undefined) where.carrier = query.carrier;
    if (query.periodKey !== undefined) where.periodKey = query.periodKey;
    if (cursor !== null) {
      where.AND = [
        this.stringKeysetPredicate(query.sort, cursor) as Prisma.ShippingReconciliationWhereInput,
      ];
    }
    const rows = await this.tenantTx(companyId, (tx) =>
      tx.shippingReconciliation.findMany({
        where,
        orderBy: [{ [query.sort.field]: query.sort.dir }, { id: query.sort.dir }],
        take: limit + 1,
        select: RECONCILIATION_LIST_SELECT,
      }),
    );
    const views = rows.map((r) => this.toReconciliationListView(r));
    return buildKeysetPage(views, limit, (view) => ({ p: view.createdAt, t: view.id }));
  }

  async findReconciliation(companyId: string, id: string): Promise<ReconciliationView | null> {
    const row = await this.tenantTx(companyId, (tx) =>
      tx.shippingReconciliation.findFirst({
        where: { id, companyId },
        select: RECONCILIATION_DETAIL_SELECT,
      }),
    );
    return row === null ? null : this.toReconciliationDetailView(row);
  }

  async createReconciliation(
    actor: WriteActor,
    data: CreateReconciliationInput,
  ): Promise<ReconciliationWriteResult> {
    if (data.lines.length === 0) throw new EmptyReconciliationError();
    return this.tenantTx(actor.companyId, async (tx) => {
      const replay = await this.findReconciliationByIdempotencyKey(
        tx,
        actor.companyId,
        data.idempotencyKey,
      );
      if (replay !== null) {
        return { reconciliation: this.toReconciliationDetailView(replay), replayed: true };
      }

      // No natural per-batch date exists (a statement covers many shipments
      // across dates); the period guard is checked against write time, same
      // as invoices/refunds.
      await this.assertPeriodOpen(tx, actor.companyId, new Date());

      // Resolve every line's shipment before writing anything: one bad
      // tracking number rejects the whole batch (D5, same all-or-nothing
      // discipline as other bulk finance writes).
      const resolved: {
        shipmentId: string;
        statementAmountMinor: bigint;
        shipmentFeeMinor: bigint;
        varianceMinor: bigint;
      }[] = [];
      for (const line of data.lines) {
        const shipment = await tx.shipment.findFirst({
          where: {
            companyId: actor.companyId,
            carrier: data.carrier,
            trackingNumber: line.trackingNumber,
          },
          select: { id: true, fee: true },
        });
        if (shipment === null) {
          throw new ShipmentNotFoundForReconciliationError(line.trackingNumber);
        }
        const statementAmountMinor = BigInt(line.statementAmountMinor);
        const shipmentFeeMinor = shipment.fee;
        resolved.push({
          shipmentId: shipment.id,
          statementAmountMinor,
          shipmentFeeMinor,
          varianceMinor: statementAmountMinor - shipmentFeeMinor,
        });
      }

      const totalStatementMinor = resolved.reduce((sum, l) => sum + l.statementAmountMinor, 0n);
      const totalFeeMinor = resolved.reduce((sum, l) => sum + l.shipmentFeeMinor, 0n);
      const totalVarianceMinor = totalStatementMinor - totalFeeMinor;

      let reconciliationId: string;
      try {
        const header = await tx.shippingReconciliation.create({
          data: stampForCreate(actor, {
            carrier: data.carrier,
            statementRef: data.statementRef,
            periodKey: data.periodKey,
            totalStatementMinor,
            totalFeeMinor,
            totalVarianceMinor,
            idempotencyKey: data.idempotencyKey ?? null,
          }) as Prisma.ShippingReconciliationUncheckedCreateInput,
          select: { id: true },
        });
        reconciliationId = header.id;
        for (const line of resolved) {
          await tx.shippingReconciliationLine.create({
            data: {
              companyId: actor.companyId,
              reconciliationId,
              shipmentId: line.shipmentId,
              statementAmountMinor: line.statementAmountMinor,
              shipmentFeeMinor: line.shipmentFeeMinor,
              varianceMinor: line.varianceMinor,
            } as Prisma.ShippingReconciliationLineUncheckedCreateInput,
          });
        }
      } catch (error) {
        const raced = await this.replayOnKeyConflict(
          tx,
          actor.companyId,
          data.idempotencyKey,
          error,
          (key) => this.findReconciliationByIdempotencyKey(tx, actor.companyId, key),
        );
        if (raced !== null) {
          return { reconciliation: this.toReconciliationDetailView(raced), replayed: true };
        }
        throw error;
      }

      const full = await tx.shippingReconciliation.findFirstOrThrow({
        where: { id: reconciliationId },
        select: RECONCILIATION_DETAIL_SELECT,
      });
      return { reconciliation: this.toReconciliationDetailView(full), replayed: false };
    });
  }

  // ---- Accounting periods (M13.5, D4) ---------------------------------------

  async listPeriods(companyId: string): Promise<readonly AccountingPeriodView[]> {
    return this.tenantTx(companyId, async (tx) => {
      const rows = await tx.accountingPeriod.findMany({
        where: { companyId },
        orderBy: { periodKey: "asc" },
        select: PERIOD_SELECT,
      });
      return rows.map((r) => this.toPeriodView(r));
    });
  }

  /**
   * Close a period atomically (D4). Locks any existing row `FOR UPDATE`
   * first; if it is already closed this is a **replay** (the operation is
   * naturally idempotent — closing an already-closed period reaches the same
   * terminal state — so no stored `Idempotency-Key` column is needed on
   * `accounting_periods` the way money-moving writes need one). Otherwise
   * runs the D4 sequential-gap check (see {@link PeriodSequenceGapError} for
   * the documented simplification) and upserts the row to `closed`.
   */
  async closePeriod(actor: WriteActor, periodKey: string): Promise<PeriodCloseResult> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const locked = await tx.$queryRaw<
        {
          id: string;
          status: string;
          closed_at: Date | null;
          closed_by: string | null;
          created_at: Date;
          updated_at: Date;
        }[]
      >`
        SELECT id, status, closed_at, closed_by, created_at, updated_at
          FROM public.accounting_periods
         WHERE company_id = ${actor.companyId}::uuid AND period_key = ${periodKey}
         FOR UPDATE`;
      const existing = locked[0];
      if (existing !== undefined && existing.status === "closed") {
        return {
          period: this.toPeriodView({
            id: existing.id,
            periodKey,
            status: existing.status,
            closedAt: existing.closed_at,
            closedBy: existing.closed_by,
            createdAt: existing.created_at,
            updatedAt: existing.updated_at,
          }),
          replayed: true,
        };
      }

      // D4 sequential check (simplified, documented on PeriodSequenceGapError):
      // any earlier period for this company still open blocks this close.
      const gapRows = await tx.$queryRaw<{ period_key: string }[]>`
        SELECT period_key FROM public.accounting_periods
         WHERE company_id = ${actor.companyId}::uuid AND period_key < ${periodKey} AND status = 'open'
         ORDER BY period_key ASC
         LIMIT 1`;
      const gap = gapRows[0];
      if (gap !== undefined) throw new PeriodSequenceGapError(periodKey, gap.period_key);

      const now = new Date();
      const row = await tx.accountingPeriod.upsert({
        where: { companyId_periodKey: { companyId: actor.companyId, periodKey } },
        create: {
          companyId: actor.companyId,
          periodKey,
          status: "closed",
          closedAt: now,
          closedBy: actor.actorId,
        },
        update: { status: "closed", closedAt: now, closedBy: actor.actorId },
        select: PERIOD_SELECT,
      });
      return { period: this.toPeriodView(row), replayed: false };
    });
  }

  // ---- Cash center + P&L (M13.5, D6 — computed reads) ----------------------------

  /**
   * Computed cash-center summary (D6): a straightforward `SUM(...)` per
   * source table over the date range, no new ledger. `collectedMinor` sums
   * `orders.collectedAmount` by `orders.updatedAt` — a documented
   * approximation, not a precise per-collection-event figure: `collectedAmount`
   * is a running total on the order row, not individually timestamped per
   * collection. `OrderActivity` rows of `kind = 'payment'` exist but only
   * carry the post-write running total (`toValue`), not a signed delta or a
   * `fromValue`, so reconstructing a period-scoped collected delta from them
   * would require walking each order's activity history — real ledger work
   * D6 explicitly avoids. `updatedAt` is the best available proxy until a
   * payment-event ledger exists (EPIC-14 territory).
   */
  async getCashCenterReport(
    companyId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<CashCenterReportView> {
    return this.tenantTx(companyId, async (tx) => {
      const range = { gte: new Date(dateFrom), lte: new Date(dateTo) };

      const [collected, expenses, poPayments, refunds, shipping] = await Promise.all([
        tx.order.aggregate({
          where: { companyId, updatedAt: range },
          _sum: { collectedAmount: true },
        }),
        tx.expense.aggregate({
          where: { companyId, incurredAt: range },
          _sum: { amountMinor: true },
        }),
        tx.purchaseOrderPayment.aggregate({
          where: { companyId, paidAt: range },
          _sum: { amountMinor: true },
        }),
        tx.refund.aggregate({
          where: { companyId, createdAt: range },
          _sum: { amountMinor: true },
        }),
        tx.shipment.aggregate({ where: { companyId, deliveredAt: range }, _sum: { fee: true } }),
      ]);

      const collectedMinor = Number(collected._sum.collectedAmount ?? 0n);
      const expensesMinor = Number(expenses._sum.amountMinor ?? 0n);
      const purchaseOrderPaymentsMinor = Number(poPayments._sum.amountMinor ?? 0n);
      const refundsMinor = Number(refunds._sum.amountMinor ?? 0n);
      const shippingFeesMinor = Number(shipping._sum.fee ?? 0n);
      const netCashMinor =
        collectedMinor -
        expensesMinor -
        purchaseOrderPaymentsMinor -
        refundsMinor -
        shippingFeesMinor;

      return {
        collectedMinor,
        expensesMinor,
        purchaseOrderPaymentsMinor,
        refundsMinor,
        shippingFeesMinor,
        netCashMinor,
      };
    });
  }

  /**
   * Computed P&L summary (D6). `revenueMinor` sums `invoices.subtotalMinor`
   * over `invoices.createdAt` — invoices are the actual billed-revenue
   * record this epic owns (order `collectedAmount`-based "net income on
   * collected" phrasing belongs to EPIC-14 analytics, not this contract).
   * `cogsMinor` sums `order_items.costSnapshot * quantity` for items on
   * orders whose `createdAt` falls in range — an approximation (perfect COGS
   * timing, e.g. at fulfillment, is EPIC-14's job); consistent with D6's
   * "computed reads" philosophy.
   */
  async getPnlReport(
    companyId: string,
    dateFrom: string,
    dateTo: string,
    compareFrom?: string,
    compareTo?: string,
  ): Promise<PnlReportView> {
    return this.tenantTx(companyId, async (tx) => {
      const current = await this.computePnlPeriod(tx, companyId, dateFrom, dateTo);
      if (compareFrom === undefined || compareTo === undefined) return { current };
      const previous = await this.computePnlPeriod(tx, companyId, compareFrom, compareTo);
      return { current, previous };
    });
  }

  private async computePnlPeriod(
    tx: Tx,
    companyId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<PnlPeriodView> {
    const range = { gte: new Date(dateFrom), lte: new Date(dateTo) };

    const [revenue, cogsItems, expenses] = await Promise.all([
      tx.invoice.aggregate({
        where: { companyId, createdAt: range },
        _sum: { subtotalMinor: true },
      }),
      tx.orderItem.findMany({
        where: { companyId, order: { createdAt: range } },
        select: { costSnapshot: true, quantity: true },
      }),
      tx.expense.aggregate({
        where: { companyId, incurredAt: range },
        _sum: { amountMinor: true },
      }),
    ]);

    const revenueMinor = Number(revenue._sum.subtotalMinor ?? 0n);
    const cogsMinor = Number(
      cogsItems.reduce((sum, item) => sum + item.costSnapshot * item.quantity, 0n),
    );
    const expensesMinor = Number(expenses._sum.amountMinor ?? 0n);
    const netIncomeMinor = revenueMinor - cogsMinor - expensesMinor;

    return { revenueMinor, cogsMinor, expensesMinor, netIncomeMinor };
  }

  // ---- internals: period-close guard (D4) -------------------------------------

  /**
   * Reject a money-moving write dated inside an already-closed accounting
   * period. Beyond the closed-check (unchanged since M13.3), this now also
   * **touches the period into existence as `open`** (M13.5) when no row
   * exists yet: every dated money-moving write creates its
   * `accounting_periods` row if absent, so the D4 sequential-gap check at
   * close time (`closePeriod`) always has a row to inspect for every month
   * that ever had activity. This does not change or weaken the close-check
   * itself — a `status = 'closed'` row still throws {@link PeriodClosedError}
   * exactly as before M13.5.
   */
  private async assertPeriodOpen(tx: Tx, companyId: string, date: Date): Promise<void> {
    const periodKey = date.toISOString().slice(0, 7);
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM public.accounting_periods
       WHERE company_id = ${companyId}::uuid AND period_key = ${periodKey}
       LIMIT 1`;
    const row = rows[0];
    if (row !== undefined && row.status === "closed") {
      throw new PeriodClosedError(periodKey);
    }
    if (row === undefined) {
      await tx.accountingPeriod.upsert({
        where: { companyId_periodKey: { companyId, periodKey } },
        create: { companyId, periodKey, status: "open" },
        update: {},
      });
    }
  }

  // ---- internals: receipt stock effect --------------------------------------

  /**
   * Raise `inventory_stock.on_hand`, append the `stock_adjustments` log row
   * (`reason = 'purchase_receipt'`), and roll `product_variants.average_cost`
   * by the moving-average formula (D7) — all for one receipt line, inside the
   * caller's transaction. Locks the variant row before the stock level so two
   * receipts of the same variant never interleave the average-cost read/write.
   */
  private async applyReceiptToStock(
    tx: Tx,
    actor: WriteActor,
    warehouseId: string,
    line: LockedPoLine,
    quantity: bigint,
  ): Promise<void> {
    const variantRows = await tx.$queryRaw<{ id: string; average_cost: bigint }[]>`
      SELECT id, average_cost FROM public.product_variants
       WHERE id = ${line.variantId}::uuid
       FOR UPDATE`;
    const variantRow = variantRows[0];
    if (variantRow === undefined) throw new ReferenceNotFoundError("variantId");
    const avgBefore = variantRow.average_cost;

    const level = await this.ensureStockLevel(tx, actor, warehouseId, line.variantId);
    const onHandBefore = level.onHand;
    const onHandAfter = onHandBefore + quantity;

    const newAvg =
      onHandAfter === 0n
        ? avgBefore
        : (onHandBefore * avgBefore + quantity * line.unitCost) / onHandAfter;

    await tx.inventoryStock.updateMany({
      where: { id: level.id },
      data: stampForUpdate(actor, {
        onHand: { increment: quantity },
      }) as Prisma.InventoryStockUncheckedUpdateManyInput,
    });
    await tx.productVariant.updateMany({
      where: { id: line.variantId },
      data: stampForUpdate(actor, {
        averageCost: newAvg,
      }) as Prisma.ProductVariantUncheckedUpdateManyInput,
    });
    await tx.stockAdjustment.create({
      data: stampForCreate(actor, {
        warehouseId,
        variantId: line.variantId,
        quantityDelta: quantity,
        reason: "purchase_receipt",
        note: null,
        idempotencyKey: null,
      }) as Prisma.StockAdjustmentUncheckedCreateInput,
    });
  }

  /**
   * Get the (warehouse, variant) stock level, creating it at zero if it does
   * not exist yet, and lock it `FOR UPDATE` for the rest of the transaction
   * (mirrors the EPIC-9 inventory repository's `ensureLevel`).
   */
  private async ensureStockLevel(
    tx: Tx,
    actor: WriteActor,
    warehouseId: string,
    variantId: string,
  ): Promise<LockedStockLevel> {
    try {
      await tx.inventoryStock.upsert({
        where: { warehouseId_variantId: { warehouseId, variantId } },
        create: stampForCreate(actor, {
          warehouseId,
          variantId,
        }) as Prisma.InventoryStockUncheckedCreateInput,
        update: {},
        select: { id: true },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
    }
    const rows = await tx.$queryRaw<{ id: string; on_hand: bigint }[]>`
      SELECT id, on_hand FROM public.inventory_stock
       WHERE warehouse_id = ${warehouseId}::uuid AND variant_id = ${variantId}::uuid
       FOR UPDATE`;
    const row = rows[0];
    if (row === undefined) throw new ReferenceNotFoundError("variantId");
    return { id: row.id, onHand: row.on_hand };
  }

  // ---- internals: tenant tx --------------------------------------------------

  private tenantTx<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return fn(tx);
    });
  }

  // ---- internals: references -------------------------------------------------

  private async assertSupplier(tx: Tx, companyId: string, id: string): Promise<void> {
    const found = await tx.supplier.findFirst({
      where: { id, companyId, isActive: true },
      select: { id: true },
    });
    if (found === null) throw new ReferenceNotFoundError("supplierId");
  }

  private async assertVariant(tx: Tx, companyId: string, id: string): Promise<void> {
    const found = await tx.productVariant.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (found === null) throw new ReferenceNotFoundError("variantId");
  }

  private async assertWarehouse(tx: Tx, companyId: string, id: string): Promise<void> {
    const found = await tx.warehouse.findFirst({
      where: { id, companyId, isActive: true },
      select: { id: true },
    });
    if (found === null) throw new ReferenceNotFoundError("warehouseId");
  }

  private async assertInvoice(tx: Tx, companyId: string, id: string): Promise<void> {
    const found = await tx.invoice.findFirst({ where: { id, companyId }, select: { id: true } });
    if (found === null) throw new ReferenceNotFoundError("invoiceId");
  }

  private async assertOrderRef(tx: Tx, companyId: string, id: string): Promise<void> {
    const found = await tx.order.findFirst({ where: { id, companyId }, select: { id: true } });
    if (found === null) throw new ReferenceNotFoundError("orderId");
  }

  // ---- internals: PO number sequence -----------------------------------------

  /** Atomically issue the next per-company PO number (race-safe upsert). */
  private async issuePoNumber(tx: Tx, companyId: string): Promise<bigint> {
    const rows = await tx.$queryRaw<{ next_number: bigint }[]>`
      INSERT INTO public.purchase_order_sequences (company_id, next_number)
      VALUES (${companyId}::uuid, 2)
      ON CONFLICT (company_id)
      DO UPDATE SET next_number = public.purchase_order_sequences.next_number + 1, updated_at = now()
      RETURNING next_number`;
    return rows[0]!.next_number - 1n;
  }

  // ---- internals: invoice number sequence + VAT rate --------------------------

  /** Atomically issue the next per-company invoice number (race-safe upsert). */
  private async issueInvoiceNumber(tx: Tx, companyId: string): Promise<bigint> {
    const rows = await tx.$queryRaw<{ next_number: bigint }[]>`
      INSERT INTO public.invoice_sequences (company_id, next_number)
      VALUES (${companyId}::uuid, 2)
      ON CONFLICT (company_id)
      DO UPDATE SET next_number = public.invoice_sequences.next_number + 1, updated_at = now()
      RETURNING next_number`;
    return rows[0]!.next_number - 1n;
  }

  /** Read the company's current `tax_settings.vatRateBps`, lazily creating the default zero-rate row. */
  private async getVatRateBps(tx: Tx, companyId: string): Promise<number> {
    const row = await tx.taxSettings.upsert({
      where: { companyId },
      create: { companyId, vatRateBps: 0, vatRegistrationNumber: null },
      update: {},
      select: { vatRateBps: true },
    });
    return row.vatRateBps;
  }

  // ---- internals: idempotency -------------------------------------------------

  private async findPoByIdempotencyKey(
    tx: Tx,
    companyId: string,
    key: string | undefined,
  ): Promise<PoDetailRow | null> {
    if (key === undefined) return null;
    return tx.purchaseOrder.findFirst({
      where: { companyId, idempotencyKey: key },
      select: PO_DETAIL_SELECT,
    });
  }

  private async findReceiptByIdempotencyKey(
    tx: Tx,
    companyId: string,
    key: string | undefined,
  ): Promise<ReceiptRow | null> {
    if (key === undefined) return null;
    return tx.purchaseOrderReceipt.findFirst({
      where: { companyId, idempotencyKey: key },
      select: RECEIPT_SELECT,
    });
  }

  private async findPaymentByIdempotencyKey(
    tx: Tx,
    companyId: string,
    key: string | undefined,
  ): Promise<Prisma.PurchaseOrderPaymentGetPayload<{ select: typeof PAYMENT_SELECT }> | null> {
    if (key === undefined) return null;
    return tx.purchaseOrderPayment.findFirst({
      where: { companyId, idempotencyKey: key },
      select: PAYMENT_SELECT,
    });
  }

  private async findExpenseByIdempotencyKey(
    tx: Tx,
    companyId: string,
    key: string | undefined,
  ): Promise<ExpenseRow | null> {
    if (key === undefined) return null;
    return tx.expense.findFirst({
      where: { companyId, idempotencyKey: key },
      select: EXPENSE_SELECT,
    });
  }

  private async findInvoiceByIdempotencyKey(
    tx: Tx,
    companyId: string,
    key: string | undefined,
  ): Promise<InvoiceDetailRow | null> {
    if (key === undefined) return null;
    return tx.invoice.findFirst({
      where: { companyId, idempotencyKey: key },
      select: INVOICE_DETAIL_SELECT,
    });
  }

  private async findRefundByIdempotencyKey(
    tx: Tx,
    companyId: string,
    key: string | undefined,
  ): Promise<RefundRow | null> {
    if (key === undefined) return null;
    return tx.refund.findFirst({
      where: { companyId, idempotencyKey: key },
      select: REFUND_SELECT,
    });
  }

  private async findReconciliationByIdempotencyKey(
    tx: Tx,
    companyId: string,
    key: string | undefined,
  ): Promise<ReconciliationDetailRow | null> {
    if (key === undefined) return null;
    return tx.shippingReconciliation.findFirst({
      where: { companyId, idempotencyKey: key },
      select: RECONCILIATION_DETAIL_SELECT,
    });
  }

  /** Turn a racing idempotency-key unique violation into the stored result. */
  private async replayOnKeyConflict<T>(
    _tx: Tx,
    _companyId: string,
    key: string | undefined,
    error: unknown,
    lookup: (key: string) => Promise<T | null>,
  ): Promise<T | null> {
    if (key === undefined) return null;
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002")
      return null;
    if (!String(error.meta?.["target"] ?? "").includes("idempotency")) return null;
    return lookup(key);
  }

  // ---- internals: keyset -----------------------------------------------------

  private stringKeysetPredicate(
    sort: { field: string; dir: "asc" | "desc" },
    cursor: DecodedCursor,
  ): object {
    const op = sort.dir === "asc" ? "gt" : "lt";
    const isTime = sort.field === "createdAt" || sort.field === "incurredAt";
    const primaryValue: string | Date = isTime ? new Date(cursor.p) : cursor.p;
    return {
      OR: [
        { [sort.field]: { [op]: primaryValue } },
        { AND: [{ [sort.field]: primaryValue }, { id: { [op]: cursor.t } }] },
      ],
    };
  }

  private decodeGeneric(field: string, raw: string | undefined): DecodedCursor | null {
    if (raw === undefined) return null;
    try {
      const decoded = decodeCursor(raw);
      const p = decoded["p"];
      const t = decoded["t"];
      if (typeof p !== "string" || typeof t !== "string") throw new InvalidListCursorError();
      if ((field === "createdAt" || field === "incurredAt") && Number.isNaN(Date.parse(p))) {
        throw new InvalidListCursorError();
      }
      return { p, t };
    } catch (error) {
      if (error instanceof InvalidCursorError) throw new InvalidListCursorError();
      throw error;
    }
  }

  // ---- internals: row -> view --------------------------------------------

  private toDateOrNull(value: string | null): Date | null {
    return value === null ? null : new Date(value);
  }

  private toSupplierView(row: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    taxId: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): SupplierView {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      taxId: row.taxId,
      active: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toListView(row: PoListRow): PurchaseOrderListView {
    return {
      id: row.id,
      number: Number(row.number),
      supplierId: row.supplierId,
      status: row.status as PurchaseOrderStatus,
      expectedDate: row.expectedDate === null ? null : row.expectedDate.toISOString(),
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetailView(row: PoDetailRow): PurchaseOrderView {
    return { ...this.toListView(row), lines: row.lines.map((l) => this.toLineView(l)) };
  }

  private toLineView(row: {
    id: string;
    variantId: string;
    quantityOrdered: bigint;
    quantityReceived: bigint;
    unitCost: bigint;
  }): PurchaseOrderLineView {
    return {
      id: row.id,
      variantId: row.variantId,
      quantityOrdered: Number(row.quantityOrdered),
      quantityReceived: Number(row.quantityReceived),
      unitCost: Number(row.unitCost),
    };
  }

  private toReceiptView(row: ReceiptRow): PurchaseOrderReceiptView {
    return {
      id: row.id,
      poId: row.poId,
      warehouseId: row.warehouseId,
      receivedAt: row.receivedAt.toISOString(),
      lines: row.lines.map((l) => ({
        id: l.id,
        poLineId: l.poLineId,
        quantity: Number(l.quantity),
      })),
    };
  }

  private toPaymentView(row: {
    id: string;
    poId: string;
    amountMinor: bigint;
    method: string;
    paidAt: Date;
  }): PurchaseOrderPaymentView {
    return {
      id: row.id,
      poId: row.poId,
      amountMinor: Number(row.amountMinor),
      method: row.method,
      paidAt: row.paidAt.toISOString(),
    };
  }

  private toExpenseView(row: ExpenseRow): ExpenseView {
    return {
      id: row.id,
      category: row.category,
      amountMinor: Number(row.amountMinor),
      incurredAt: row.incurredAt.toISOString(),
      notes: row.notes,
      supplierId: row.supplierId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toTaxSettingsView(row: TaxSettingsRow): TaxSettingsView {
    return {
      companyId: row.companyId,
      vatRateBps: row.vatRateBps,
      vatRegistrationNumber: row.vatRegistrationNumber,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toInvoiceListView(row: InvoiceListRow): InvoiceListView {
    return {
      id: row.id,
      number: Number(row.number),
      orderId: row.orderId,
      subtotalMinor: Number(row.subtotalMinor),
      vatMinor: Number(row.vatMinor),
      totalMinor: Number(row.totalMinor),
      vatRateBpsSnapshot: row.vatRateBpsSnapshot,
      pdfGeneratedAt: row.pdfGeneratedAt === null ? null : row.pdfGeneratedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toInvoiceDetailView(row: InvoiceDetailRow): InvoiceView {
    return {
      ...this.toInvoiceListView(row),
      lines: row.lines.map((l) => this.toInvoiceLineView(l)),
    };
  }

  private toInvoiceLineView(row: {
    id: string;
    description: string;
    quantity: bigint;
    unitPriceMinor: bigint;
    lineTotalMinor: bigint;
  }): InvoiceLineView {
    return {
      id: row.id,
      description: row.description,
      quantity: Number(row.quantity),
      unitPriceMinor: Number(row.unitPriceMinor),
      lineTotalMinor: Number(row.lineTotalMinor),
    };
  }

  private toRefundView(row: RefundRow): RefundView {
    return {
      id: row.id,
      invoiceId: row.invoiceId,
      orderId: row.orderId,
      amountMinor: Number(row.amountMinor),
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toReconciliationListView(row: ReconciliationListRow): ReconciliationListView {
    return {
      id: row.id,
      carrier: row.carrier,
      statementRef: row.statementRef,
      periodKey: row.periodKey,
      totalStatementMinor: Number(row.totalStatementMinor),
      totalFeeMinor: Number(row.totalFeeMinor),
      totalVarianceMinor: Number(row.totalVarianceMinor),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toReconciliationDetailView(row: ReconciliationDetailRow): ReconciliationView {
    return {
      ...this.toReconciliationListView(row),
      lines: row.lines.map((l) => this.toReconciliationLineView(l)),
    };
  }

  private toReconciliationLineView(row: {
    id: string;
    shipmentId: string;
    statementAmountMinor: bigint;
    shipmentFeeMinor: bigint;
    varianceMinor: bigint;
  }): ReconciliationLineView {
    return {
      id: row.id,
      shipmentId: row.shipmentId,
      statementAmountMinor: Number(row.statementAmountMinor),
      shipmentFeeMinor: Number(row.shipmentFeeMinor),
      varianceMinor: Number(row.varianceMinor),
    };
  }

  private toPeriodView(row: {
    id: string;
    periodKey: string;
    status: string;
    closedAt: Date | null;
    closedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): AccountingPeriodView {
    return {
      id: row.id,
      periodKey: row.periodKey,
      status: row.status as AccountingPeriodStatus,
      closedAt: row.closedAt === null ? null : row.closedAt.toISOString(),
      closedBy: row.closedBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
