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
  AdjustInput,
  CreateWarehouseInput,
  InventoryRepositoryPort,
  ReserveInput,
  SetReorderPointInput,
  SetVariantWarehouseInput,
  TransferInput,
  UpdateWarehouseInput,
  WriteActor,
} from "../domain/inventory-repository.port";
import type {
  AdjustmentReason,
  AdjustmentView,
  ReservationView,
  StockChangeReason,
  StockEffect,
  StockLevelView,
  StockWriteResult,
  TransferView,
  WarehouseView,
} from "../domain/inventory.entity";
import {
  DuplicateWarehouseError,
  InsufficientStockError,
  InvalidListCursorError,
  ReferenceNotFoundError,
} from "../domain/inventory.errors";
import type { ParsedStockListQuery, ParsedWarehouseListQuery } from "../domain/list-query";
import { INVENTORY_PRISMA_CLIENT } from "./prisma-client.provider";

/** A Prisma client or transaction client. */
type Tx = Prisma.TransactionClient;

/** A decoded keyset cursor: primary sort value + id tie-breaker. */
interface DecodedCursor {
  readonly p: string;
  readonly t: string;
}

/** A stock level row locked `FOR UPDATE` inside the current transaction. */
interface LockedLevel {
  readonly id: string;
  readonly warehouseId: string;
  readonly variantId: string;
  readonly onHand: number;
  readonly committed: number;
  readonly reorderPoint: number;
}

const WAREHOUSE_SELECT = {
  id: true,
  name: true,
  code: true,
  address: true,
  isDefault: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const STOCK_SELECT = {
  id: true,
  warehouseId: true,
  variantId: true,
  onHand: true,
  committed: true,
  available: true,
  reorderPoint: true,
  updatedAt: true,
} as const;

const RESERVATION_SELECT = {
  id: true,
  warehouseId: true,
  variantId: true,
  quantity: true,
  orderId: true,
  reference: true,
  status: true,
  releasedAt: true,
  createdAt: true,
} as const;

const TRANSFER_SELECT = {
  id: true,
  fromWarehouseId: true,
  toWarehouseId: true,
  variantId: true,
  quantity: true,
  note: true,
  createdAt: true,
} as const;

const ADJUSTMENT_SELECT = {
  id: true,
  warehouseId: true,
  variantId: true,
  quantityDelta: true,
  reason: true,
  note: true,
  createdAt: true,
} as const;

/**
 * Prisma-backed inventory repository (EPIC-9). Every unit of work binds the
 * tenant under RLS (`setTenantContext`) — the app-layer half of the two-layer
 * isolation model — so both the WHERE clause and Postgres RLS agree on the
 * company.
 *
 * **Atomicity.** Each of the four stock writes runs in one transaction that
 * first locks the affected `inventory_stock` rows with `SELECT … FOR UPDATE`,
 * then checks the balance, then moves it and appends its log row. Two concurrent
 * reservations of the last unit therefore serialize: the second sees the first's
 * committed units and fails with {@link InsufficientStockError} instead of
 * overselling. Transfers lock both sides in a deterministic (warehouse-id)
 * order so two opposing transfers cannot deadlock.
 *
 * **Idempotency.** When a write carries an `Idempotency-Key`, the key is stored
 * on the log row under a per-company unique index. A retry finds the stored row
 * and returns it as a `replayed` result — no stock moves twice, even if two
 * retries race (the unique violation is caught and re-read).
 */
@Injectable()
export class InventoryRepository implements InventoryRepositoryPort {
  constructor(@Inject(INVENTORY_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // ---- Warehouses ----------------------------------------------------------

  async listWarehouses(
    companyId: string,
    query: ParsedWarehouseListQuery,
  ): Promise<KeysetPage<WarehouseView>> {
    const limit = clampLimit(query.limit);
    const cursor = this.decode(query.sort.field, query.cursor);
    const where: Prisma.WarehouseWhereInput = { companyId };
    if (query.active !== "all") where.isActive = query.active;
    if (query.q !== undefined) {
      where.OR = [
        { name: { contains: query.q, mode: "insensitive" } },
        { code: { contains: query.q, mode: "insensitive" } },
      ];
    }
    if (cursor !== null) {
      where.AND = [this.keysetPredicate(query.sort, cursor) as Prisma.WarehouseWhereInput];
    }
    const rows = await this.tenantTx(companyId, (tx) =>
      tx.warehouse.findMany({
        where,
        orderBy: [{ [query.sort.field]: query.sort.dir }, { id: query.sort.dir }],
        take: limit + 1,
        select: WAREHOUSE_SELECT,
      }),
    );
    const views = rows.map((r) => this.toWarehouseView(r));
    return buildKeysetPage(views, limit, (view) => this.warehouseCursor(query.sort.field, view));
  }

  async findWarehouse(companyId: string, id: string): Promise<WarehouseView | null> {
    const row = await this.tenantTx(companyId, (tx) =>
      tx.warehouse.findFirst({ where: { id, companyId }, select: WAREHOUSE_SELECT }),
    );
    return row === null ? null : this.toWarehouseView(row);
  }

  async createWarehouse(actor: WriteActor, data: CreateWarehouseInput): Promise<WarehouseView> {
    return this.tenantTx(actor.companyId, async (tx) => {
      if (data.isDefault === true) await this.clearDefault(tx, actor);
      try {
        const row = await tx.warehouse.create({
          data: stampForCreate(actor, {
            name: data.name,
            code: data.code ?? null,
            address: data.address ?? null,
            isDefault: data.isDefault ?? false,
          }) as Prisma.WarehouseUncheckedCreateInput,
          select: WAREHOUSE_SELECT,
        });
        return this.toWarehouseView(row);
      } catch (error) {
        throw this.mapWarehouseWriteError(error);
      }
    });
  }

  async updateWarehouse(
    actor: WriteActor,
    id: string,
    data: UpdateWarehouseInput,
  ): Promise<WarehouseView | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const where = { id, companyId: actor.companyId };
      if (data.isDefault === true) await this.clearDefault(tx, actor, id);
      const patch: Record<string, unknown> = {};
      if (data.name !== undefined) patch["name"] = data.name;
      if (data.code !== undefined) patch["code"] = data.code;
      if (data.address !== undefined) patch["address"] = data.address;
      if (data.isDefault !== undefined) patch["isDefault"] = data.isDefault;
      if (data.active !== undefined) patch["isActive"] = data.active;
      try {
        const { count } = await tx.warehouse.updateMany({
          where,
          data: stampForUpdate(actor, patch) as Prisma.WarehouseUncheckedUpdateManyInput,
        });
        if (count === 0) return null;
      } catch (error) {
        throw this.mapWarehouseWriteError(error);
      }
      const row = await tx.warehouse.findFirst({ where, select: WAREHOUSE_SELECT });
      return row === null ? null : this.toWarehouseView(row);
    });
  }

  async archiveWarehouse(actor: WriteActor, id: string): Promise<WarehouseView | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const where = { id, companyId: actor.companyId };
      const { count } = await tx.warehouse.updateMany({
        where,
        // Archiving also drops the default flag so the partial unique index frees up.
        data: stampForUpdate(actor, {
          isActive: false,
          isDefault: false,
        }) as Prisma.WarehouseUncheckedUpdateManyInput,
      });
      if (count === 0) return null;
      const row = await tx.warehouse.findFirst({ where, select: WAREHOUSE_SELECT });
      return row === null ? null : this.toWarehouseView(row);
    });
  }

  // ---- Stock levels --------------------------------------------------------

  async listStock(
    companyId: string,
    query: ParsedStockListQuery,
  ): Promise<KeysetPage<StockLevelView>> {
    const limit = clampLimit(query.limit);
    const cursor = this.decode(query.sort.field, query.cursor);
    const where: Prisma.InventoryStockWhereInput = { companyId };
    if (query.warehouseId !== undefined) where.warehouseId = query.warehouseId;
    if (query.variantId !== undefined) where.variantId = query.variantId;
    // "At or below the threshold", and only where a threshold is actually set.
    if (query.belowReorder) {
      where.reorderPoint = { gt: 0 };
      where.available = { lte: this.prisma.inventoryStock.fields.reorderPoint };
    }
    if (cursor !== null) {
      where.AND = [this.keysetPredicate(query.sort, cursor) as Prisma.InventoryStockWhereInput];
    }
    const rows = await this.tenantTx(companyId, (tx) =>
      tx.inventoryStock.findMany({
        where,
        orderBy: [{ [query.sort.field]: query.sort.dir }, { id: query.sort.dir }],
        take: limit + 1,
        select: STOCK_SELECT,
      }),
    );
    const views = rows.map((r) => this.toStockView(r));
    return buildKeysetPage(views, limit, (view) => this.stockCursor(query.sort.field, view));
  }

  async setReorderPoint(actor: WriteActor, data: SetReorderPointInput): Promise<StockLevelView> {
    return this.tenantTx(actor.companyId, async (tx) => {
      await this.assertWarehouse(tx, actor.companyId, data.warehouseId);
      await this.assertVariant(tx, actor.companyId, data.variantId);
      const level = await this.ensureLevel(tx, actor, data.warehouseId, data.variantId);
      await tx.inventoryStock.updateMany({
        where: { id: level.id },
        data: stampForUpdate(actor, {
          reorderPoint: BigInt(data.reorderPoint),
        }) as Prisma.InventoryStockUncheckedUpdateManyInput,
      });
      return this.readLevel(tx, level.id);
    });
  }

  async setVariantWarehouse(
    actor: WriteActor,
    data: SetVariantWarehouseInput,
  ): Promise<StockLevelView> {
    return this.tenantTx(actor.companyId, async (tx) => {
      await this.assertWarehouse(tx, actor.companyId, data.warehouseId);
      await this.assertVariant(tx, actor.companyId, data.variantId);
      const level = await this.ensureLevel(tx, actor, data.warehouseId, data.variantId);
      await tx.inventoryStock.deleteMany({
        where: {
          companyId: actor.companyId,
          variantId: data.variantId,
          warehouseId: { not: data.warehouseId },
          onHand: BigInt(0),
          committed: BigInt(0),
        },
      });
      return this.readLevel(tx, level.id);
    });
  }

  // ---- Atomic stock writes -------------------------------------------------

  async reserve(actor: WriteActor, data: ReserveInput): Promise<StockWriteResult<ReservationView>> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const replay = await this.findReservationByKey(tx, actor.companyId, data.idempotencyKey);
      if (replay !== null) return { record: replay, effects: [], replayed: true };

      await this.assertWarehouse(tx, actor.companyId, data.warehouseId);
      const allowOversell = await this.assertVariant(tx, actor.companyId, data.variantId);
      const level = await this.ensureLevel(tx, actor, data.warehouseId, data.variantId);

      const availableUnits = level.onHand - level.committed;
      if (!allowOversell && data.quantity > availableUnits) {
        throw new InsufficientStockError(data.quantity, availableUnits);
      }

      let row;
      try {
        row = await tx.stockReservation.create({
          data: stampForCreate(actor, {
            warehouseId: data.warehouseId,
            variantId: data.variantId,
            quantity: BigInt(data.quantity),
            orderId: data.orderId ?? null,
            reference: data.reference ?? null,
            status: "active",
            idempotencyKey: data.idempotencyKey ?? null,
          }) as Prisma.StockReservationUncheckedCreateInput,
          select: RESERVATION_SELECT,
        });
      } catch (error) {
        const replayed = await this.replayReservation(
          tx,
          actor.companyId,
          data.idempotencyKey,
          error,
        );
        return { record: replayed, effects: [], replayed: true };
      }

      const effect = await this.applyDelta(tx, actor, level, 0, data.quantity, "reserved");
      return { record: this.toReservationView(row), effects: [effect], replayed: false };
    });
  }

  async release(
    actor: WriteActor,
    reservationId: string,
  ): Promise<StockWriteResult<ReservationView> | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const existing = await tx.stockReservation.findFirst({
        where: { id: reservationId, companyId: actor.companyId },
        select: RESERVATION_SELECT,
      });
      if (existing === null) return null;
      // Releasing twice is a no-op, not an error: the caller's intent already holds.
      if (existing.status !== "active") {
        return { record: this.toReservationView(existing), effects: [], replayed: true };
      }

      const level = await this.ensureLevel(tx, actor, existing.warehouseId, existing.variantId);
      const quantity = Number(existing.quantity);
      // Guard against a level that somehow holds fewer committed units than this
      // reservation (manual repair, legacy data): never drive committed negative.
      const release = Math.min(quantity, level.committed);

      const { count } = await tx.stockReservation.updateMany({
        where: { id: reservationId, companyId: actor.companyId, status: "active" },
        data: stampForUpdate(actor, {
          status: "released",
          releasedAt: new Date(),
        }) as Prisma.StockReservationUncheckedUpdateManyInput,
      });
      if (count === 0) {
        // Another transaction released it first — replay its result.
        const current = await tx.stockReservation.findFirst({
          where: { id: reservationId, companyId: actor.companyId },
          select: RESERVATION_SELECT,
        });
        return current === null
          ? null
          : { record: this.toReservationView(current), effects: [], replayed: true };
      }

      const effect = await this.applyDelta(tx, actor, level, 0, -release, "released");
      const row = await tx.stockReservation.findFirst({
        where: { id: reservationId, companyId: actor.companyId },
        select: RESERVATION_SELECT,
      });
      return {
        record: this.toReservationView(row ?? existing),
        effects: [effect],
        replayed: false,
      };
    });
  }

  async transfer(actor: WriteActor, data: TransferInput): Promise<StockWriteResult<TransferView>> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const replay = await this.findTransferByKey(tx, actor.companyId, data.idempotencyKey);
      if (replay !== null) return { record: replay, effects: [], replayed: true };

      await this.assertWarehouse(tx, actor.companyId, data.fromWarehouseId, "fromWarehouseId");
      await this.assertWarehouse(tx, actor.companyId, data.toWarehouseId, "toWarehouseId");
      await this.assertVariant(tx, actor.companyId, data.variantId);

      // Lock both sides in a deterministic order so opposing transfers of the
      // same pair queue up instead of deadlocking.
      const [firstId, secondId] = [data.fromWarehouseId, data.toWarehouseId].sort();
      const first = await this.ensureLevel(tx, actor, firstId as string, data.variantId);
      const second = await this.ensureLevel(tx, actor, secondId as string, data.variantId);
      const source = first.warehouseId === data.fromWarehouseId ? first : second;
      const target = source === first ? second : first;

      if (data.quantity > source.onHand) {
        throw new InsufficientStockError(data.quantity, source.onHand);
      }

      let row;
      try {
        row = await tx.stockTransfer.create({
          data: stampForCreate(actor, {
            fromWarehouseId: data.fromWarehouseId,
            toWarehouseId: data.toWarehouseId,
            variantId: data.variantId,
            quantity: BigInt(data.quantity),
            note: data.note ?? null,
            idempotencyKey: data.idempotencyKey ?? null,
          }) as Prisma.StockTransferUncheckedCreateInput,
          select: TRANSFER_SELECT,
        });
      } catch (error) {
        const replayed = await this.replayTransfer(tx, actor.companyId, data.idempotencyKey, error);
        return { record: replayed, effects: [], replayed: true };
      }

      const out = await this.applyDelta(tx, actor, source, -data.quantity, 0, "transferred");
      const into = await this.applyDelta(tx, actor, target, data.quantity, 0, "transferred");
      return { record: this.toTransferView(row), effects: [out, into], replayed: false };
    });
  }

  async adjust(actor: WriteActor, data: AdjustInput): Promise<StockWriteResult<AdjustmentView>> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const replay = await this.findAdjustmentByKey(tx, actor.companyId, data.idempotencyKey);
      if (replay !== null) return { record: replay, effects: [], replayed: true };

      await this.assertWarehouse(tx, actor.companyId, data.warehouseId);
      await this.assertVariant(tx, actor.companyId, data.variantId);
      const level = await this.ensureLevel(tx, actor, data.warehouseId, data.variantId);

      if (level.onHand + data.quantityDelta < 0) {
        throw new InsufficientStockError(
          Math.abs(data.quantityDelta),
          level.onHand,
          "quantityDelta",
        );
      }

      let row;
      try {
        row = await tx.stockAdjustment.create({
          data: stampForCreate(actor, {
            warehouseId: data.warehouseId,
            variantId: data.variantId,
            quantityDelta: BigInt(data.quantityDelta),
            reason: data.reason,
            note: data.note ?? null,
            idempotencyKey: data.idempotencyKey ?? null,
          }) as Prisma.StockAdjustmentUncheckedCreateInput,
          select: ADJUSTMENT_SELECT,
        });
      } catch (error) {
        const replayed = await this.replayAdjustment(
          tx,
          actor.companyId,
          data.idempotencyKey,
          error,
        );
        return { record: replayed, effects: [], replayed: true };
      }

      const effect = await this.applyDelta(tx, actor, level, data.quantityDelta, 0, "adjusted");
      return { record: this.toAdjustmentView(row), effects: [effect], replayed: false };
    });
  }

  // ---- internals: transactions + locking -----------------------------------

  /** Run a unit of work with the tenant RLS context bound for its duration. */
  private tenantTx<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return fn(tx);
    });
  }

  /**
   * Get the (warehouse, variant) level, creating it at zero if it does not exist
   * yet, and lock it `FOR UPDATE` for the rest of the transaction. Every stock
   * write goes through here before it reads a balance.
   */
  private async ensureLevel(
    tx: Tx,
    actor: WriteActor,
    warehouseId: string,
    variantId: string,
  ): Promise<LockedLevel> {
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
      // A concurrent creator won the race; the row now exists — carry on.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
    }
    const rows = await tx.$queryRaw<
      { id: string; on_hand: bigint; committed: bigint; reorder_point: bigint }[]
    >`SELECT id, on_hand, committed, reorder_point
        FROM public.inventory_stock
       WHERE warehouse_id = ${warehouseId}::uuid
         AND variant_id = ${variantId}::uuid
       FOR UPDATE`;
    const row = rows[0];
    if (row === undefined) throw new ReferenceNotFoundError("variantId");
    return {
      id: row.id,
      warehouseId,
      variantId,
      onHand: Number(row.on_hand),
      committed: Number(row.committed),
      reorderPoint: Number(row.reorder_point),
    };
  }

  /**
   * Apply signed deltas to a locked level and report the effect. `available` is
   * recomputed by the database trigger, so it is read back rather than derived
   * here. `crossedLow` is edge-triggered: it is only true when the level sat
   * above its reorder point before the write and lands at or below it after.
   */
  private async applyDelta(
    tx: Tx,
    actor: WriteActor,
    level: LockedLevel,
    onHandDelta: number,
    committedDelta: number,
    reason: StockChangeReason,
  ): Promise<StockEffect> {
    await tx.inventoryStock.updateMany({
      where: { id: level.id },
      data: stampForUpdate(actor, {
        onHand: { increment: BigInt(onHandDelta) },
        committed: { increment: BigInt(committedDelta) },
      }) as Prisma.InventoryStockUncheckedUpdateManyInput,
    });
    const after = await this.readLevel(tx, level.id);
    const availableBefore = level.onHand - level.committed;
    const threshold = after.reorderPoint;
    const crossedLow = threshold > 0 && availableBefore > threshold && after.available <= threshold;
    return {
      warehouseId: level.warehouseId,
      variantId: level.variantId,
      reason,
      onHandDelta,
      committedDelta,
      level: after,
      crossedLow,
    };
  }

  /** Read one level back after a write (inside the same transaction). */
  private async readLevel(tx: Tx, id: string): Promise<StockLevelView> {
    const row = await tx.inventoryStock.findFirstOrThrow({ where: { id }, select: STOCK_SELECT });
    return this.toStockView(row);
  }

  // ---- internals: references + idempotency ---------------------------------

  /** Confirm the warehouse exists, is active, and belongs to this company. */
  private async assertWarehouse(
    tx: Tx,
    companyId: string,
    id: string,
    field = "warehouseId",
  ): Promise<void> {
    const found = await tx.warehouse.findFirst({
      where: { id, companyId, isActive: true },
      select: { id: true },
    });
    if (found === null) throw new ReferenceNotFoundError(field);
  }

  /**
   * Confirm the variant exists and belongs to this company, returning its
   * product's oversell policy (EPIC-8 `products.allow_oversell`).
   */
  private async assertVariant(tx: Tx, companyId: string, id: string): Promise<boolean> {
    const found = await tx.productVariant.findFirst({
      where: { id, companyId },
      select: { id: true, product: { select: { allowOversell: true } } },
    });
    if (found === null) throw new ReferenceNotFoundError("variantId");
    return found.product.allowOversell;
  }

  private async findReservationByKey(
    tx: Tx,
    companyId: string,
    key: string | undefined,
  ): Promise<ReservationView | null> {
    if (key === undefined) return null;
    const row = await tx.stockReservation.findFirst({
      where: { companyId, idempotencyKey: key },
      select: RESERVATION_SELECT,
    });
    return row === null ? null : this.toReservationView(row);
  }

  private async findTransferByKey(
    tx: Tx,
    companyId: string,
    key: string | undefined,
  ): Promise<TransferView | null> {
    if (key === undefined) return null;
    const row = await tx.stockTransfer.findFirst({
      where: { companyId, idempotencyKey: key },
      select: TRANSFER_SELECT,
    });
    return row === null ? null : this.toTransferView(row);
  }

  private async findAdjustmentByKey(
    tx: Tx,
    companyId: string,
    key: string | undefined,
  ): Promise<AdjustmentView | null> {
    if (key === undefined) return null;
    const row = await tx.stockAdjustment.findFirst({
      where: { companyId, idempotencyKey: key },
      select: ADJUSTMENT_SELECT,
    });
    return row === null ? null : this.toAdjustmentView(row);
  }

  /** Turn a racing idempotency-key unique violation into the stored result. */
  private async replayReservation(
    tx: Tx,
    companyId: string,
    key: string | undefined,
    error: unknown,
  ): Promise<ReservationView> {
    this.assertIdempotencyRace(error, key);
    const stored = await this.findReservationByKey(tx, companyId, key);
    if (stored === null) throw error;
    return stored;
  }

  private async replayTransfer(
    tx: Tx,
    companyId: string,
    key: string | undefined,
    error: unknown,
  ): Promise<TransferView> {
    this.assertIdempotencyRace(error, key);
    const stored = await this.findTransferByKey(tx, companyId, key);
    if (stored === null) throw error;
    return stored;
  }

  private async replayAdjustment(
    tx: Tx,
    companyId: string,
    key: string | undefined,
    error: unknown,
  ): Promise<AdjustmentView> {
    this.assertIdempotencyRace(error, key);
    const stored = await this.findAdjustmentByKey(tx, companyId, key);
    if (stored === null) throw error;
    return stored;
  }

  /** Rethrow anything that is not a concurrent same-key insert. */
  private assertIdempotencyRace(error: unknown, key: string | undefined): void {
    const isKeyViolation =
      key !== undefined &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      String(error.meta?.["target"] ?? "").includes("idempotency");
    if (!isKeyViolation) throw error;
  }

  /** Clear the current default warehouse (at most one per company). */
  private async clearDefault(tx: Tx, actor: WriteActor, exceptId?: string): Promise<void> {
    await tx.warehouse.updateMany({
      where: {
        companyId: actor.companyId,
        isDefault: true,
        ...(exceptId === undefined ? {} : { NOT: { id: exceptId } }),
      },
      data: stampForUpdate(actor, {
        isDefault: false,
      }) as Prisma.WarehouseUncheckedUpdateManyInput,
    });
  }

  // ---- internals: keyset ---------------------------------------------------

  private keysetPredicate(
    sort: { field: string; dir: "asc" | "desc" },
    cursor: DecodedCursor,
  ): object {
    const op = sort.dir === "asc" ? "gt" : "lt";
    const isTime = sort.field === "createdAt" || sort.field === "updatedAt";
    const primaryValue: string | Date | bigint = isTime
      ? new Date(cursor.p)
      : sort.field === "available"
        ? BigInt(cursor.p)
        : cursor.p;
    return {
      OR: [
        { [sort.field]: { [op]: primaryValue } },
        { AND: [{ [sort.field]: primaryValue }, { id: { [op]: cursor.t } }] },
      ],
    };
  }

  private warehouseCursor(field: string, view: WarehouseView): CursorValues {
    return { p: field === "createdAt" ? view.createdAt : view.name, t: view.id };
  }

  private stockCursor(field: string, view: StockLevelView): CursorValues {
    return { p: field === "updatedAt" ? view.updatedAt : String(view.available), t: view.id };
  }

  private decode(field: string, raw: string | undefined): DecodedCursor | null {
    if (raw === undefined) return null;
    try {
      const decoded = decodeCursor(raw);
      const p = decoded["p"];
      const t = decoded["t"];
      if (typeof p !== "string" || typeof t !== "string") throw new InvalidListCursorError();
      if ((field === "createdAt" || field === "updatedAt") && Number.isNaN(Date.parse(p))) {
        throw new InvalidListCursorError();
      }
      if (field === "available" && !/^-?\d+$/.test(p)) throw new InvalidListCursorError();
      return { p, t };
    } catch (error) {
      if (error instanceof InvalidCursorError) throw new InvalidListCursorError();
      throw error;
    }
  }

  // ---- internals: row → view ----------------------------------------------

  private toWarehouseView(row: {
    id: string;
    name: string;
    code: string | null;
    address: string | null;
    isDefault: boolean;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): WarehouseView {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      address: row.address,
      isDefault: row.isDefault,
      active: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toStockView(row: {
    id: string;
    warehouseId: string;
    variantId: string;
    onHand: bigint;
    committed: bigint;
    available: bigint;
    reorderPoint: bigint;
    updatedAt: Date;
  }): StockLevelView {
    return {
      id: row.id,
      warehouseId: row.warehouseId,
      variantId: row.variantId,
      onHand: Number(row.onHand),
      committed: Number(row.committed),
      available: Number(row.available),
      reorderPoint: Number(row.reorderPoint),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toReservationView(row: {
    id: string;
    warehouseId: string;
    variantId: string;
    quantity: bigint;
    orderId: string | null;
    reference: string | null;
    status: string;
    releasedAt: Date | null;
    createdAt: Date;
  }): ReservationView {
    return {
      id: row.id,
      warehouseId: row.warehouseId,
      variantId: row.variantId,
      quantity: Number(row.quantity),
      orderId: row.orderId,
      reference: row.reference,
      status: row.status === "released" ? "released" : "active",
      releasedAt: row.releasedAt === null ? null : row.releasedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toTransferView(row: {
    id: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    variantId: string;
    quantity: bigint;
    note: string | null;
    createdAt: Date;
  }): TransferView {
    return {
      id: row.id,
      fromWarehouseId: row.fromWarehouseId,
      toWarehouseId: row.toWarehouseId,
      variantId: row.variantId,
      quantity: Number(row.quantity),
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toAdjustmentView(row: {
    id: string;
    warehouseId: string;
    variantId: string;
    quantityDelta: bigint;
    reason: string;
    note: string | null;
    createdAt: Date;
  }): AdjustmentView {
    return {
      id: row.id,
      warehouseId: row.warehouseId,
      variantId: row.variantId,
      quantityDelta: Number(row.quantityDelta),
      reason: row.reason as AdjustmentReason,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Map a Prisma unique-violation to the right duplicate-field domain error. */
  private mapWarehouseWriteError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.["target"] ?? "");
      if (target.includes("code")) return new DuplicateWarehouseError("code");
      if (target.includes("default")) return new DuplicateWarehouseError("isDefault");
      return new DuplicateWarehouseError("name");
    }
    return error;
  }
}
