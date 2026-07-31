import { Inject, Injectable } from "@nestjs/common";
import {
  buildKeysetPage,
  clampLimit,
  type CursorValues,
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
  BulkItemResult,
  OrderActivityView,
  OrderItemView,
  OrderListView,
  OrderView,
  OrderWriteResult,
  StatusChangeResult,
} from "../domain/order.entity";
import {
  derivePaymentStatus,
  type OrderStatus,
  ORDER_STATUSES,
  canTransition,
  requiresReason,
  stockEffectOf,
} from "../domain/order-status";
import type { ParsedOrderListQuery } from "../domain/list-query";
import {
  DuplicateOrderError,
  EmptyOrderError,
  IllegalTransitionError,
  InsufficientStockError,
  InvalidAmountError,
  InvalidListCursorError,
  ReasonRequiredError,
  ReferenceNotFoundError,
} from "../domain/orders.errors";
import type {
  CreateOrderInput,
  CreateOrderItemInput,
  OrdersRepositoryPort,
  TransitionInput,
  UpdateOrderInput,
  WriteActor,
} from "../domain/orders-repository.port";
import { ORDERS_PRISMA_CLIENT } from "./prisma-client.provider";

type Tx = Prisma.TransactionClient;

interface DecodedCursor {
  readonly p: string;
  readonly t: string;
}

const ORDER_LIST_SELECT = {
  id: true,
  orderNumber: true,
  customerId: true,
  assigneeId: true,
  status: true,
  followUpState: true,
  labelId: true,
  reasonId: true,
  governorateId: true,
  subtotal: true,
  shippingFee: true,
  discount: true,
  total: true,
  collectedAmount: true,
  paymentStatus: true,
  statusChangedAt: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { name: true } },
  _count: { select: { items: true } },
} as const;

const ITEM_SELECT = {
  id: true,
  variantId: true,
  nameSnapshot: true,
  quantity: true,
  price: true,
  costSnapshot: true,
} as const;

const ORDER_DETAIL_SELECT = {
  ...ORDER_LIST_SELECT,
  notes: true,
  items: { select: ITEM_SELECT, orderBy: { createdAt: "asc" as const } },
} as const;

type OrderListRow = Prisma.OrderGetPayload<{ select: typeof ORDER_LIST_SELECT }>;
type OrderDetailRow = Prisma.OrderGetPayload<{ select: typeof ORDER_DETAIL_SELECT }>;

/**
 * Prisma-backed orders repository (EPIC-11). Beyond the usual CRUD it owns four
 * things, each inside a single tenant transaction so they commit atomically:
 *
 * 1. **Tenant isolation** — `setTenantContext` binds RLS for every unit of work.
 * 2. **Order-number issuance** — an atomic `INSERT … ON CONFLICT DO UPDATE …
 *    RETURNING` on `order_sequences` serializes the per-company number.
 * 3. **Stock side effects** (decision D2, feature-gated by the caller) — reserve
 *    on `processing`, ship (decrement on-hand + release) on `shipped`, release on
 *    a pre-ship cancel/return — reusing the EPIC-9 `SELECT … FOR UPDATE` path.
 * 4. **Customer KPI recompute** (decision D3) — `orders_count` / `total_spent` /
 *    `last_order_at` recomputed from the customer's own orders in the same
 *    transaction, so they can never drift.
 */
@Injectable()
export class OrdersRepository implements OrdersRepositoryPort {
  constructor(@Inject(ORDERS_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async list(companyId: string, query: ParsedOrderListQuery): Promise<KeysetPage<OrderListView>> {
    const limit = clampLimit(query.limit);
    const cursor = this.decode(query.cursor);
    const where = this.buildWhere(companyId, query, cursor, true);
    const orderBy = [{ [query.sort.field]: query.sort.dir }, { id: query.sort.dir }];
    const rows = await this.tenantTx(companyId, (tx) =>
      tx.order.findMany({ where, orderBy, take: limit + 1, select: ORDER_LIST_SELECT }),
    );
    const views = rows.map((r) => this.toListView(r));
    return buildKeysetPage(views, limit, (view) => this.toCursor(query, view));
  }

  async statusCounts(
    companyId: string,
    query: ParsedOrderListQuery,
  ): Promise<Record<OrderStatus, number>> {
    // Counts reflect every filter EXCEPT status (the tabs partition by status).
    const where = this.buildWhere(companyId, query, null, false);
    const grouped = await this.tenantTx(companyId, (tx) =>
      tx.order.groupBy({ by: ["status"], where, _count: { _all: true } }),
    );
    const counts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<
      OrderStatus,
      number
    >;
    for (const row of grouped) counts[row.status as OrderStatus] = row._count._all;
    return counts;
  }

  async findById(companyId: string, id: string): Promise<OrderView | null> {
    const row = await this.tenantTx(companyId, (tx) =>
      tx.order.findFirst({ where: { id, companyId }, select: ORDER_DETAIL_SELECT }),
    );
    return row === null ? null : this.toDetailView(row);
  }

  async create(actor: WriteActor, data: CreateOrderInput): Promise<OrderWriteResult> {
    if (data.items.length === 0) throw new EmptyOrderError();
    return this.tenantTx(actor.companyId, async (tx) => {
      const replay = await this.findByIdempotencyKey(tx, actor.companyId, data.idempotencyKey);
      if (replay !== null) return { order: this.toDetailView(replay), replayed: true };

      await this.assertCustomer(tx, data.customerId);
      await this.assertReferences(tx, data);
      const lines = await this.resolveItems(tx, data.items);
      const money = this.computeMoney(lines, data.shippingFee ?? 0, data.discount ?? 0);
      const orderNumber = await this.issueNumber(tx, actor.companyId);

      try {
        const order = await tx.order.create({
          data: stampForCreate(actor, {
            orderNumber,
            customerId: data.customerId,
            assigneeId: data.assigneeId ?? null,
            labelId: data.labelId ?? null,
            reasonId: data.reasonId ?? null,
            governorateId: data.governorateId ?? null,
            followUpState: data.followUpState ?? "none",
            subtotal: BigInt(money.subtotal),
            shippingFee: BigInt(money.shippingFee),
            discount: BigInt(money.discount),
            total: BigInt(money.total),
            paymentStatus: "unpaid",
            notes: data.notes ?? null,
            idempotencyKey: data.idempotencyKey ?? null,
          }) as Prisma.OrderUncheckedCreateInput,
          select: { id: true },
        });
        await this.insertItems(tx, actor, order.id, lines);
        await this.addActivity(tx, actor, order.id, {
          kind: "created",
          toValue: "new",
        });
        await this.recomputeCustomerKpis(tx, actor.companyId, data.customerId);
        const full = await tx.order.findFirstOrThrow({
          where: { id: order.id },
          select: ORDER_DETAIL_SELECT,
        });
        return { order: this.toDetailView(full), replayed: false };
      } catch (error) {
        const raced = await this.replayOnKeyConflict(
          tx,
          actor.companyId,
          data.idempotencyKey,
          error,
        );
        if (raced !== null) return { order: this.toDetailView(raced), replayed: true };
        throw this.mapWriteError(error);
      }
    });
  }

  async update(actor: WriteActor, id: string, data: UpdateOrderInput): Promise<OrderView | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const current = await tx.order.findFirst({
        where: { id, companyId: actor.companyId },
        select: {
          id: true,
          customerId: true,
          status: true,
          subtotal: true,
          shippingFee: true,
          discount: true,
          total: true,
          collectedAmount: true,
        },
      });
      if (current === null) return null;
      await this.assertReferences(tx, data);

      const patch: Record<string, unknown> = {};
      if (data.assigneeId !== undefined) patch["assigneeId"] = data.assigneeId;
      if (data.labelId !== undefined) patch["labelId"] = data.labelId;
      if (data.reasonId !== undefined) patch["reasonId"] = data.reasonId;
      if (data.governorateId !== undefined) patch["governorateId"] = data.governorateId;
      if (data.followUpState !== undefined) patch["followUpState"] = data.followUpState;
      if (data.notes !== undefined) patch["notes"] = data.notes;

      // Recompute the money block when items or any amount changed.
      let subtotal = Number(current.subtotal);
      if (data.items !== undefined) {
        if (data.items.length === 0) throw new EmptyOrderError();
        const lines = await this.resolveItems(tx, data.items);
        subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
        await tx.orderItem.deleteMany({ where: { orderId: id, companyId: actor.companyId } });
        await this.insertItems(tx, actor, id, lines);
      }
      const shippingFee = data.shippingFee ?? Number(current.shippingFee);
      const discount = data.discount ?? Number(current.discount);
      const money = this.computeMoney(
        // computeMoney takes lines; reuse via a synthetic subtotal
        [{ price: subtotal, quantity: 1, variantId: "", nameSnapshot: "", costSnapshot: 0 }],
        shippingFee,
        discount,
      );
      patch["subtotal"] = BigInt(money.subtotal);
      patch["shippingFee"] = BigInt(money.shippingFee);
      patch["discount"] = BigInt(money.discount);
      patch["total"] = BigInt(money.total);

      let collectedDelta = 0;
      if (data.collectedAmount !== undefined) {
        if (data.collectedAmount < 0) throw new InvalidAmountError("collectedAmount");
        collectedDelta = data.collectedAmount - Number(current.collectedAmount);
        patch["collectedAmount"] = BigInt(data.collectedAmount);
        patch["paymentStatus"] = derivePaymentStatus(data.collectedAmount, money.total);
      } else {
        // Total may have changed; keep paymentStatus consistent with it.
        patch["paymentStatus"] = derivePaymentStatus(Number(current.collectedAmount), money.total);
      }

      try {
        await tx.order.updateMany({
          where: { id, companyId: actor.companyId },
          data: stampForUpdate(actor, patch) as Prisma.OrderUncheckedUpdateManyInput,
        });
      } catch (error) {
        throw this.mapWriteError(error);
      }
      await this.addActivity(tx, actor, id, { kind: "edited" });
      if (collectedDelta !== 0) {
        await this.addActivity(tx, actor, id, {
          kind: "payment",
          toValue: String(data.collectedAmount),
        });
      }
      await this.recomputeCustomerKpis(tx, actor.companyId, current.customerId);
      const full = await tx.order.findFirstOrThrow({ where: { id }, select: ORDER_DETAIL_SELECT });
      return this.toDetailView(full);
    });
  }

  async transition(
    actor: WriteActor,
    id: string,
    data: TransitionInput,
  ): Promise<StatusChangeResult | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      // Lock the order row for the transition so concurrent transitions serialize.
      const locked = await tx.$queryRaw<{ id: string; status: string; customer_id: string }[]>`
        SELECT id, status, customer_id
          FROM public.orders
         WHERE id = ${id}::uuid AND company_id = ${actor.companyId}::uuid
         FOR UPDATE`;
      const row = locked[0];
      if (row === undefined) return null;
      const from = row.status as OrderStatus;
      const to = data.toStatus;

      if (from === to) throw new IllegalTransitionError(from, to);
      if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
      if (requiresReason(to)) await this.assertCancelReason(tx, data.reasonId);

      if (data.applyStock) await this.applyStockEffect(tx, actor, id, from, to);

      const patch: Record<string, unknown> = { status: to, statusChangedAt: new Date() };
      if (data.reasonId !== undefined && data.reasonId !== null) patch["reasonId"] = data.reasonId;
      await tx.order.updateMany({
        where: { id, companyId: actor.companyId },
        data: stampForUpdate(actor, patch) as Prisma.OrderUncheckedUpdateManyInput,
      });
      await this.addActivity(tx, actor, id, {
        kind: "status_changed",
        fromValue: from,
        toValue: to,
        ...(data.note !== undefined && data.note !== null ? { note: data.note } : {}),
      });
      await this.recomputeCustomerKpis(tx, actor.companyId, row.customer_id);
      const full = await tx.order.findFirstOrThrow({ where: { id }, select: ORDER_DETAIL_SELECT });
      return { order: this.toDetailView(full), fromStatus: from, toStatus: to, collectedDelta: 0 };
    });
  }

  async assign(
    actor: WriteActor,
    id: string,
    assigneeId: string | null,
  ): Promise<OrderView | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const current = await tx.order.findFirst({
        where: { id, companyId: actor.companyId },
        select: { id: true, assigneeId: true },
      });
      if (current === null) return null;
      if (assigneeId !== null) await this.assertAssignee(tx, actor.companyId, assigneeId);
      await tx.order.updateMany({
        where: { id, companyId: actor.companyId },
        data: stampForUpdate(actor, { assigneeId }) as Prisma.OrderUncheckedUpdateManyInput,
      });
      await this.addActivity(tx, actor, id, {
        kind: "assigned",
        fromValue: current.assigneeId,
        toValue: assigneeId,
      });
      const full = await tx.order.findFirstOrThrow({ where: { id }, select: ORDER_DETAIL_SELECT });
      return this.toDetailView(full);
    });
  }

  async bulkTransition(
    actor: WriteActor,
    ids: readonly string[],
    data: TransitionInput,
  ): Promise<{ results: BulkItemResult[]; changes: StatusChangeResult[] }> {
    const results: BulkItemResult[] = [];
    const changes: StatusChangeResult[] = [];
    // Atomic PER ITEM: each transition is its own transaction, so one bad order
    // never rolls back the others (api-conventions: bulk reports per-item results).
    for (const id of ids) {
      try {
        const change = await this.transition(actor, id, data);
        if (change === null) {
          results.push({
            orderId: id,
            ok: false,
            error: { code: "NOT_FOUND", message: "Order not found." },
          });
        } else {
          results.push({ orderId: id, ok: true });
          changes.push(change);
        }
      } catch (error) {
        results.push({ orderId: id, ok: false, error: this.toBulkError(error) });
      }
    }
    return { results, changes };
  }

  async bulkAssign(
    actor: WriteActor,
    ids: readonly string[],
    assigneeId: string | null,
  ): Promise<BulkItemResult[]> {
    const results: BulkItemResult[] = [];
    for (const id of ids) {
      try {
        const order = await this.assign(actor, id, assigneeId);
        results.push(
          order === null
            ? { orderId: id, ok: false, error: { code: "NOT_FOUND", message: "Order not found." } }
            : { orderId: id, ok: true },
        );
      } catch (error) {
        results.push({ orderId: id, ok: false, error: this.toBulkError(error) });
      }
    }
    return results;
  }

  async listActivity(
    companyId: string,
    orderId: string,
    limit: number | undefined,
    cursor: string | undefined,
  ): Promise<KeysetPage<OrderActivityView> | null> {
    return this.tenantTx(companyId, async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, companyId },
        select: { id: true },
      });
      if (order === null) return null;
      const take = clampLimit(limit);
      const decoded = this.decode(cursor);
      const where: Prisma.OrderActivityWhereInput = { orderId, companyId };
      if (decoded !== null) {
        where.OR = [
          { createdAt: { lt: new Date(decoded.p) } },
          { AND: [{ createdAt: new Date(decoded.p) }, { id: { lt: decoded.t } }] },
        ];
      }
      const rows = await tx.orderActivity.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: take + 1,
        select: {
          id: true,
          kind: true,
          fromValue: true,
          toValue: true,
          note: true,
          actorId: true,
          createdAt: true,
        },
      });
      const views = rows.map((r) => this.toActivityView(r));
      return buildKeysetPage(views, take, (v) => ({ p: v.createdAt, t: v.id }));
    });
  }

  // ---- internals: tenant tx + views ----------------------------------------

  private tenantTx<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return fn(tx);
    });
  }

  private toListView(row: OrderListRow): OrderListView {
    return {
      id: row.id,
      orderNumber: Number(row.orderNumber),
      customerId: row.customerId,
      customerName: row.customer.name,
      assigneeId: row.assigneeId,
      status: row.status as OrderStatus,
      followUpState: row.followUpState as OrderListView["followUpState"],
      labelId: row.labelId,
      reasonId: row.reasonId,
      governorateId: row.governorateId,
      itemCount: row._count.items,
      subtotal: Number(row.subtotal),
      shippingFee: Number(row.shippingFee),
      discount: Number(row.discount),
      total: Number(row.total),
      collectedAmount: Number(row.collectedAmount),
      paymentStatus: row.paymentStatus as OrderListView["paymentStatus"],
      statusChangedAt: row.statusChangedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetailView(row: OrderDetailRow): OrderView {
    return {
      ...this.toListView(row),
      notes: row.notes,
      items: row.items.map((i) => this.toItemView(i)),
    };
  }

  private toItemView(row: {
    id: string;
    variantId: string;
    nameSnapshot: string;
    quantity: bigint;
    price: bigint;
    costSnapshot: bigint;
  }): OrderItemView {
    return {
      id: row.id,
      variantId: row.variantId,
      nameSnapshot: row.nameSnapshot,
      quantity: Number(row.quantity),
      price: Number(row.price),
      costSnapshot: Number(row.costSnapshot),
    };
  }

  private toActivityView(row: {
    id: string;
    kind: string;
    fromValue: string | null;
    toValue: string | null;
    note: string | null;
    actorId: string | null;
    createdAt: Date;
  }): OrderActivityView {
    return {
      id: row.id,
      kind: row.kind,
      fromValue: row.fromValue,
      toValue: row.toValue,
      note: row.note,
      actorId: row.actorId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---- internals: numbers, items, money ------------------------------------

  /** Atomically issue the next per-company order number (race-safe upsert). */
  private async issueNumber(tx: Tx, companyId: string): Promise<bigint> {
    const rows = await tx.$queryRaw<{ next_number: bigint }[]>`
      INSERT INTO public.order_sequences (company_id, next_number)
      VALUES (${companyId}::uuid, 2)
      ON CONFLICT (company_id)
      DO UPDATE SET next_number = public.order_sequences.next_number + 1, updated_at = now()
      RETURNING next_number`;
    // The row we just wrote holds the NEXT number; the one we use is one less.
    return rows[0]!.next_number - 1n;
  }

  private async resolveItems(
    tx: Tx,
    items: readonly CreateOrderItemInput[],
  ): Promise<ResolvedLine[]> {
    const lines: ResolvedLine[] = [];
    for (const item of items) {
      if (item.quantity <= 0) throw new InvalidAmountError("quantity");
      if (item.price < 0) throw new InvalidAmountError("price");
      const variant = await tx.productVariant.findFirst({
        where: { id: item.variantId, isActive: true },
        select: { id: true, name: true, averageCost: true, product: { select: { name: true } } },
      });
      if (variant === null) throw new ReferenceNotFoundError("variantId");
      lines.push({
        variantId: variant.id,
        nameSnapshot: `${variant.product.name} — ${variant.name}`,
        quantity: item.quantity,
        price: item.price,
        costSnapshot: Number(variant.averageCost),
      });
    }
    return lines;
  }

  private async insertItems(
    tx: Tx,
    actor: WriteActor,
    orderId: string,
    lines: readonly ResolvedLine[],
  ): Promise<void> {
    for (const line of lines) {
      await tx.orderItem.create({
        data: stampForCreate(actor, {
          orderId,
          variantId: line.variantId,
          nameSnapshot: line.nameSnapshot,
          quantity: BigInt(line.quantity),
          price: BigInt(line.price),
          costSnapshot: BigInt(line.costSnapshot),
        }) as Prisma.OrderItemUncheckedCreateInput,
      });
    }
  }

  private computeMoney(
    lines: readonly ResolvedLine[],
    shippingFee: number,
    discount: number,
  ): { subtotal: number; shippingFee: number; discount: number; total: number } {
    if (shippingFee < 0) throw new InvalidAmountError("shippingFee");
    if (discount < 0) throw new InvalidAmountError("discount");
    const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
    const total = subtotal + shippingFee - discount;
    if (total < 0) throw new InvalidAmountError("discount");
    return { subtotal, shippingFee, discount, total };
  }

  // ---- internals: stock side effects (decision D2) -------------------------

  /**
   * Run the stock side effect of a transition, feature-gated by the caller
   * (`applyStock`). Reuses the EPIC-9 `SELECT … FOR UPDATE` level lock so
   * concurrent stock writes serialize instead of oversell.
   */
  private async applyStockEffect(
    tx: Tx,
    actor: WriteActor,
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
  ): Promise<void> {
    const effect = stockEffectOf(from, to);
    if (effect === "none") return;

    if (effect === "reserve") {
      const warehouseId = await this.defaultWarehouse(tx);
      const items = await tx.orderItem.findMany({
        where: { orderId, companyId: actor.companyId },
        select: { variantId: true, quantity: true },
      });
      for (const item of items) {
        const qty = Number(item.quantity);
        const level = await this.lockLevel(tx, actor, warehouseId, item.variantId);
        const allowOversell = await this.variantOversell(tx, item.variantId);
        const available = level.onHand - level.committed;
        if (!allowOversell && qty > available) throw new InsufficientStockError();
        await tx.inventoryStock.updateMany({
          where: { id: level.id },
          data: stampForUpdate(actor, {
            committed: { increment: BigInt(qty) },
          }) as Prisma.InventoryStockUncheckedUpdateManyInput,
        });
        await tx.stockReservation.create({
          data: stampForCreate(actor, {
            warehouseId,
            variantId: item.variantId,
            quantity: BigInt(qty),
            orderId,
            status: "active",
          }) as Prisma.StockReservationUncheckedCreateInput,
        });
      }
      return;
    }

    // ship / release both consume the order's active reservations.
    const reservations = await tx.stockReservation.findMany({
      where: { orderId, companyId: actor.companyId, status: "active" },
      select: { id: true, warehouseId: true, variantId: true, quantity: true },
    });
    for (const res of reservations) {
      const qty = Number(res.quantity);
      const level = await this.lockLevel(tx, actor, res.warehouseId, res.variantId);
      const release = Math.min(qty, level.committed);
      await tx.inventoryStock.updateMany({
        where: { id: level.id },
        data: stampForUpdate(actor, {
          committed: { increment: BigInt(-release) },
          // `ship` also removes the units from on-hand; `release` leaves on-hand.
          ...(effect === "ship" ? { onHand: { increment: BigInt(-release) } } : {}),
        }) as Prisma.InventoryStockUncheckedUpdateManyInput,
      });
      await tx.stockReservation.updateMany({
        where: { id: res.id },
        data: stampForUpdate(actor, {
          status: "released",
          releasedAt: new Date(),
        }) as Prisma.StockReservationUncheckedUpdateManyInput,
      });
    }
  }

  private async lockLevel(
    tx: Tx,
    actor: WriteActor,
    warehouseId: string,
    variantId: string,
  ): Promise<{ id: string; onHand: number; committed: number }> {
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
    const rows = await tx.$queryRaw<{ id: string; on_hand: bigint; committed: bigint }[]>`
      SELECT id, on_hand, committed
        FROM public.inventory_stock
       WHERE warehouse_id = ${warehouseId}::uuid AND variant_id = ${variantId}::uuid
       FOR UPDATE`;
    const row = rows[0];
    if (row === undefined) throw new ReferenceNotFoundError("variantId");
    return { id: row.id, onHand: Number(row.on_hand), committed: Number(row.committed) };
  }

  private async defaultWarehouse(tx: Tx): Promise<string> {
    const preferred = await tx.warehouse.findFirst({
      where: { isActive: true, isDefault: true },
      select: { id: true },
    });
    if (preferred !== null) return preferred.id;
    const any = await tx.warehouse.findMany({
      where: { isActive: true },
      select: { id: true },
      take: 2,
    });
    if (any.length === 1) return any[0]!.id;
    // No default and not exactly one → the caller must set a default warehouse.
    throw new ReferenceNotFoundError("warehouseId");
  }

  private async variantOversell(tx: Tx, variantId: string): Promise<boolean> {
    const found = await tx.productVariant.findFirst({
      where: { id: variantId },
      select: { product: { select: { allowOversell: true } } },
    });
    return found?.product.allowOversell ?? false;
  }

  // ---- internals: references, kpis, activity, idempotency ------------------

  private async assertCustomer(tx: Tx, customerId: string): Promise<void> {
    const found = await tx.customer.findFirst({ where: { id: customerId }, select: { id: true } });
    if (found === null) throw new ReferenceNotFoundError("customerId");
  }

  private async assertReferences(
    tx: Tx,
    data: {
      labelId?: string | null;
      reasonId?: string | null;
      governorateId?: string | null;
      assigneeId?: string | null;
    },
  ): Promise<void> {
    if (data.labelId !== undefined && data.labelId !== null) {
      const found = await tx.orderLabel.findFirst({
        where: { id: data.labelId },
        select: { id: true },
      });
      if (found === null) throw new ReferenceNotFoundError("labelId");
    }
    if (data.reasonId !== undefined && data.reasonId !== null) {
      const found = await tx.orderReason.findFirst({
        where: { id: data.reasonId },
        select: { id: true },
      });
      if (found === null) throw new ReferenceNotFoundError("reasonId");
    }
    if (data.governorateId !== undefined && data.governorateId !== null) {
      const found = await tx.governorate.findFirst({
        where: { id: data.governorateId },
        select: { id: true },
      });
      if (found === null) throw new ReferenceNotFoundError("governorateId");
    }
  }

  private async assertAssignee(tx: Tx, companyId: string, userId: string): Promise<void> {
    const found = await tx.companyMember.findFirst({
      where: { companyId, userId, status: "active" },
      select: { id: true },
    });
    if (found === null) throw new ReferenceNotFoundError("assigneeId");
  }

  private async assertCancelReason(tx: Tx, reasonId: string | null | undefined): Promise<void> {
    if (reasonId === null || reasonId === undefined) throw new ReasonRequiredError();
    const found = await tx.orderReason.findFirst({
      where: { id: reasonId, kind: { in: ["cancel", "cancellation"] } },
      select: { id: true },
    });
    if (found === null) throw new ReasonRequiredError();
  }

  /**
   * Recompute the customer's derived KPIs from its own orders, in this same
   * transaction (decision D3). `total_spent` is the COD money collected across
   * non-cancelled orders; `orders_count` and `last_order_at` follow suit.
   */
  private async recomputeCustomerKpis(
    tx: Tx,
    companyId: string,
    customerId: string,
  ): Promise<void> {
    const stats = await tx.order.aggregate({
      where: { companyId, customerId, status: { not: "cancelled" } },
      _count: { _all: true },
      _sum: { collectedAmount: true },
      _max: { createdAt: true },
    });
    await tx.customer.updateMany({
      where: { id: customerId, companyId },
      data: {
        ordersCount: stats._count._all,
        totalSpent: stats._sum.collectedAmount ?? 0n,
        lastOrderAt: stats._max.createdAt ?? null,
      } as Prisma.CustomerUncheckedUpdateManyInput,
    });
  }

  private async addActivity(
    tx: Tx,
    actor: WriteActor,
    orderId: string,
    entry: {
      kind: string;
      fromValue?: string | null;
      toValue?: string | null;
      note?: string | null;
    },
  ): Promise<void> {
    await tx.orderActivity.create({
      data: {
        companyId: actor.companyId,
        orderId,
        kind: entry.kind,
        fromValue: entry.fromValue ?? null,
        toValue: entry.toValue ?? null,
        note: entry.note ?? null,
        actorId: actor.actorId,
      } as Prisma.OrderActivityUncheckedCreateInput,
    });
  }

  private async findByIdempotencyKey(
    tx: Tx,
    companyId: string,
    key: string | null | undefined,
  ): Promise<OrderDetailRow | null> {
    if (key === null || key === undefined) return null;
    return tx.order.findFirst({
      where: { companyId, idempotencyKey: key },
      select: ORDER_DETAIL_SELECT,
    });
  }

  private async replayOnKeyConflict(
    tx: Tx,
    companyId: string,
    key: string | null | undefined,
    error: unknown,
  ): Promise<OrderDetailRow | null> {
    if (key === null || key === undefined) return null;
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      return null;
    }
    if (!String(error.meta?.["target"] ?? "").includes("idempotency")) return null;
    return this.findByIdempotencyKey(tx, companyId, key);
  }

  // ---- internals: cursors + error mapping ----------------------------------

  private buildWhere(
    companyId: string,
    query: ParsedOrderListQuery,
    cursor: DecodedCursor | null,
    includeStatus: boolean,
  ): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = { companyId };
    if (includeStatus && query.status !== undefined) where.status = query.status;
    if (query.followUpState !== undefined) where.followUpState = query.followUpState;
    if (query.assigneeId !== undefined) where.assigneeId = query.assigneeId;
    if (query.customerId !== undefined) where.customerId = query.customerId;
    if (query.labelId !== undefined) where.labelId = query.labelId;
    if (query.reasonId !== undefined) where.reasonId = query.reasonId;
    if (query.governorateId !== undefined) where.governorateId = query.governorateId;
    if (query.createdAtFrom !== undefined || query.createdAtTo !== undefined) {
      where.createdAt = {
        ...(query.createdAtFrom !== undefined ? { gte: new Date(query.createdAtFrom) } : {}),
        ...(query.createdAtTo !== undefined ? { lte: new Date(query.createdAtTo) } : {}),
      };
    }
    if (query.search !== undefined) {
      if (query.search.kind === "number") {
        where.orderNumber = BigInt(query.search.value);
      } else {
        where.customer = { name: { contains: query.search.term, mode: "insensitive" } };
      }
    }
    if (cursor !== null) where.AND = [this.keysetPredicate(query, cursor)];
    return where;
  }

  private keysetPredicate(
    query: ParsedOrderListQuery,
    cursor: DecodedCursor,
  ): Prisma.OrderWhereInput {
    const primary = query.sort.field;
    const op = query.sort.dir === "asc" ? "gt" : "lt";
    return {
      OR: [
        { [primary]: { [op]: new Date(cursor.p) } },
        { AND: [{ [primary]: new Date(cursor.p) }, { id: { [op]: cursor.t } }] },
      ],
    } as Prisma.OrderWhereInput;
  }

  private toCursor(query: ParsedOrderListQuery, view: OrderListView): CursorValues {
    const p = query.sort.field === "createdAt" ? view.createdAt : view.updatedAt;
    return { p, t: view.id };
  }

  /**
   * Decode a keyset cursor. Both whitelisted order sorts (`createdAt`,
   * `updatedAt`) and the activity cursor use a timestamp primary + id
   * tie-breaker, so one decoder serves them all.
   */
  private decode(raw: string | undefined): DecodedCursor | null {
    if (raw === undefined) return null;
    try {
      const decoded = decodeCursor(raw);
      const p = decoded["p"];
      const t = decoded["t"];
      if (typeof p !== "string" || typeof t !== "string") throw new InvalidListCursorError();
      if (Number.isNaN(Date.parse(p))) throw new InvalidListCursorError();
      return { p, t };
    } catch (error) {
      if (error instanceof InvalidCursorError) throw new InvalidListCursorError();
      throw error;
    }
  }

  private toBulkError(error: unknown): { code: string; message: string } {
    if (error instanceof IllegalTransitionError)
      return { code: "UNPROCESSABLE_ENTITY", message: error.message };
    if (error instanceof ReasonRequiredError)
      return { code: "UNPROCESSABLE_ENTITY", message: error.message };
    if (error instanceof InsufficientStockError)
      return { code: "UNPROCESSABLE_ENTITY", message: error.message };
    if (error instanceof ReferenceNotFoundError)
      return { code: "UNPROCESSABLE_ENTITY", message: error.message };
    return { code: "INTERNAL", message: "The order could not be updated." };
  }

  private mapWriteError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.["target"] ?? "");
      if (target.includes("idempotency")) return new DuplicateOrderError("idempotencyKey");
    }
    return error;
  }
}

/** A resolved order line: the variant plus its frozen snapshot values. */
interface ResolvedLine {
  readonly variantId: string;
  readonly nameSnapshot: string;
  readonly quantity: number;
  readonly price: number;
  readonly costSnapshot: number;
}
