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
  CreatePaymentInput,
  CreatePurchaseOrderInput,
  CreateReceiptInput,
  CreateSupplierInput,
  FinanceRepositoryPort,
  UpdateSupplierInput,
  WriteActor,
} from "../domain/finance-repository.port";
import type {
  PurchaseOrderListView,
  PurchaseOrderLineView,
  PurchaseOrderPaymentResult,
  PurchaseOrderPaymentView,
  PurchaseOrderReceiptResult,
  PurchaseOrderReceiptView,
  PurchaseOrderStatus,
  PurchaseOrderView,
  PurchaseOrderWriteResult,
  SupplierView,
} from "../domain/finance.entity";
import {
  EmptyPurchaseOrderError,
  IllegalPurchaseOrderStateError,
  InvalidAmountError,
  InvalidListCursorError,
  OverReceiptError,
  ReferenceNotFoundError,
} from "../domain/finance.errors";
import type { ParsedPurchaseOrderListQuery, ParsedSupplierListQuery } from "../domain/list-query";
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

type PoListRow = Prisma.PurchaseOrderGetPayload<{ select: typeof PO_LIST_SELECT }>;
type PoDetailRow = Prisma.PurchaseOrderGetPayload<{ select: typeof PO_DETAIL_SELECT }>;
type ReceiptRow = Prisma.PurchaseOrderReceiptGetPayload<{ select: typeof RECEIPT_SELECT }>;

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

      await this.assertSupplier(tx, data.supplierId);
      for (const line of data.lines) {
        if (line.quantityOrdered <= 0) throw new InvalidAmountError("quantityOrdered");
        if (line.unitCost < 0) throw new InvalidAmountError("unitCost");
        await this.assertVariant(tx, line.variantId);
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

      await this.assertWarehouse(tx, data.warehouseId);

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

  private async assertSupplier(tx: Tx, id: string): Promise<void> {
    const found = await tx.supplier.findFirst({
      where: { id, isActive: true },
      select: { id: true },
    });
    if (found === null) throw new ReferenceNotFoundError("supplierId");
  }

  private async assertVariant(tx: Tx, id: string): Promise<void> {
    const found = await tx.productVariant.findFirst({ where: { id }, select: { id: true } });
    if (found === null) throw new ReferenceNotFoundError("variantId");
  }

  private async assertWarehouse(tx: Tx, id: string): Promise<void> {
    const found = await tx.warehouse.findFirst({
      where: { id, isActive: true },
      select: { id: true },
    });
    if (found === null) throw new ReferenceNotFoundError("warehouseId");
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
    const isTime = sort.field === "createdAt";
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
      if (field === "createdAt" && Number.isNaN(Date.parse(p))) throw new InvalidListCursorError();
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
}
