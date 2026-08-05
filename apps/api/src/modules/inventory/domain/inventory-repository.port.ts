import type { KeysetPage } from "@cadeau/database";
import type {
  AdjustmentReason,
  AdjustmentView,
  ReservationView,
  StockLevelView,
  StockWriteResult,
  TransferView,
  WarehouseView,
} from "./inventory.entity";
import type { ParsedStockListQuery, ParsedWarehouseListQuery } from "./list-query";

/** The tenant + acting member for a write. */
export interface WriteActor {
  readonly companyId: string;
  readonly actorId: string;
}

/** Fields accepted when creating a warehouse. */
export interface CreateWarehouseInput {
  readonly name: string;
  readonly code?: string | null;
  readonly address?: string | null;
  readonly isDefault?: boolean;
}

/** Partial update for a warehouse; omitted keys are left unchanged. */
export interface UpdateWarehouseInput {
  readonly name?: string;
  readonly code?: string | null;
  readonly address?: string | null;
  readonly isDefault?: boolean;
  readonly active?: boolean;
}

/** A reserve request. `idempotencyKey` makes a retry a replay, not a double-commit. */
export interface ReserveInput {
  readonly warehouseId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly orderId?: string | null;
  readonly reference?: string | null;
  readonly idempotencyKey?: string | undefined;
}

/** A transfer request between two distinct warehouses. */
export interface TransferInput {
  readonly fromWarehouseId: string;
  readonly toWarehouseId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly note?: string | null;
  readonly idempotencyKey?: string | undefined;
}

/** A reason-coded correction. `quantityDelta` is signed and never zero. */
export interface AdjustInput {
  readonly warehouseId: string;
  readonly variantId: string;
  readonly quantityDelta: number;
  readonly reason: AdjustmentReason;
  readonly note?: string | null;
  readonly idempotencyKey?: string | undefined;
}

/** A low-stock threshold for one (warehouse, variant) level. */
export interface SetReorderPointInput {
  readonly warehouseId: string;
  readonly variantId: string;
  readonly reorderPoint: number;
}

/**
 * Port for reading and moving inventory (EPIC-9). The Prisma adapter binds the
 * tenant under RLS for every unit of work (the app-layer half of the two-layer
 * isolation model), and runs each of the four stock writes — reserve, release,
 * transfer, adjust — inside **one transaction** that locks the affected level
 * rows (`SELECT … FOR UPDATE`) before moving them, so concurrent callers cannot
 * interleave a read and a write and oversell.
 *
 * Uniqueness violations surface as {@link DuplicateWarehouseError}; a bad tenant
 * reference as {@link ReferenceNotFoundError}; a write that would drive stock
 * negative as {@link InsufficientStockError}; a bad cursor as
 * {@link InvalidListCursorError}. Not-found reads/writes return `null`.
 */
export interface InventoryRepositoryPort {
  // ---- Warehouses ----------------------------------------------------------

  listWarehouses(
    companyId: string,
    query: ParsedWarehouseListQuery,
  ): Promise<KeysetPage<WarehouseView>>;

  findWarehouse(companyId: string, id: string): Promise<WarehouseView | null>;

  createWarehouse(actor: WriteActor, data: CreateWarehouseInput): Promise<WarehouseView>;

  updateWarehouse(
    actor: WriteActor,
    id: string,
    data: UpdateWarehouseInput,
  ): Promise<WarehouseView | null>;

  /** Archive a warehouse (`is_active = false`). Returns the row, or `null` if absent. */
  archiveWarehouse(actor: WriteActor, id: string): Promise<WarehouseView | null>;

  // ---- Stock levels --------------------------------------------------------

  listStock(companyId: string, query: ParsedStockListQuery): Promise<KeysetPage<StockLevelView>>;

  /** Upsert the low-stock threshold for a level. `null` when a reference is unknown. */
  setReorderPoint(actor: WriteActor, data: SetReorderPointInput): Promise<StockLevelView>;

  // ---- Atomic stock writes -------------------------------------------------

  reserve(actor: WriteActor, data: ReserveInput): Promise<StockWriteResult<ReservationView>>;

  /**
   * Release an active reservation, lowering `committed` by its quantity.
   * Returns `null` when the reservation is unknown in this tenant; a reservation
   * that was already released comes back as a `replayed` result (idempotent).
   */
  release(
    actor: WriteActor,
    reservationId: string,
  ): Promise<StockWriteResult<ReservationView> | null>;

  transfer(actor: WriteActor, data: TransferInput): Promise<StockWriteResult<TransferView>>;

  adjust(actor: WriteActor, data: AdjustInput): Promise<StockWriteResult<AdjustmentView>>;
}

/** DI token for {@link InventoryRepositoryPort}. */
export const INVENTORY_REPOSITORY = Symbol("INVENTORY_REPOSITORY");
