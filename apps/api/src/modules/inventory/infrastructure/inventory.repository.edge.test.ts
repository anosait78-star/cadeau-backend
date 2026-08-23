/**
 * Edge-path coverage for the inventory repository: cursor decoding, partial
 * warehouse patches, the level-locking race handling, and every idempotency
 * replay branch. The happy paths live in `inventory.repository.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import { encodeCursor, Prisma, type PrismaClient } from "@cadeau/database";
import { InvalidListCursorError, ReferenceNotFoundError } from "../domain/inventory.errors";
import { InventoryRepository } from "./inventory.repository";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const WAREHOUSE = "33333333-3333-3333-3333-333333333333";
const OTHER = "44444444-4444-4444-4444-444444444444";
const VARIANT = "55555555-5555-5555-5555-555555555555";
const PRODUCT = "66666666-6666-6666-6666-666666666666";
const IMAGE = "https://cdn.example.com/a.png";
const ACTOR_CTX = { companyId: COMPANY, actorId: ACTOR };
const CREATED = new Date("2026-01-02T03:04:05.000Z");
const UPDATED = new Date("2026-01-03T03:04:05.000Z");

function warehouseRow(extra: Record<string, unknown> = {}) {
  return {
    id: "w1",
    name: "Main",
    code: null,
    address: null,
    isDefault: false,
    isActive: true,
    createdAt: CREATED,
    updatedAt: UPDATED,
    ...extra,
  };
}

function stockRow(extra: Record<string, unknown> = {}) {
  return {
    id: "s1",
    warehouseId: WAREHOUSE,
    variantId: VARIANT,
    onHand: 10n,
    committed: 2n,
    available: 8n,
    reorderPoint: 0n,
    updatedAt: UPDATED,
    variant: {
      name: "Red / L",
      sku: "SKU-1",
      product: { id: PRODUCT, name: "Satin bouquet", imageUrl: IMAGE },
    },
    ...extra,
  };
}

function reservationRow(extra: Record<string, unknown> = {}) {
  return {
    id: "r1",
    warehouseId: WAREHOUSE,
    variantId: VARIANT,
    quantity: 2n,
    orderId: null,
    reference: null,
    status: "active",
    releasedAt: null,
    createdAt: CREATED,
    ...extra,
  };
}

function transferRow() {
  return {
    id: "t1",
    fromWarehouseId: WAREHOUSE,
    toWarehouseId: OTHER,
    variantId: VARIANT,
    quantity: 3n,
    note: null,
    createdAt: CREATED,
  };
}

function adjustmentRow() {
  return {
    id: "a1",
    warehouseId: WAREHOUSE,
    variantId: VARIANT,
    quantityDelta: -3n,
    reason: "damage",
    note: null,
    createdAt: CREATED,
  };
}

/** A raw `SELECT … FOR UPDATE` row as Postgres returns it (snake_case, bigint). */
function lockedRow(onHand = 10n, committed = 2n, reorderPoint = 0n) {
  return { id: "s1", on_hand: onHand, committed, reorder_point: reorderPoint };
}

function delegate() {
  return {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findFirstOrThrow: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn().mockResolvedValue({ id: "s1" }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
}

function makeRepo() {
  const models = {
    warehouse: delegate(),
    inventoryStock: delegate(),
    stockReservation: delegate(),
    stockTransfer: delegate(),
    stockAdjustment: delegate(),
    productVariant: delegate(),
  };
  const queryRaw = vi.fn().mockResolvedValue([]);
  const txHost = { $queryRaw: queryRaw, ...models };
  const prisma = {
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(txHost)),
    inventoryStock: { fields: { reorderPoint: Symbol("reorderPoint") } },
  };
  return { repo: new InventoryRepository(prisma as unknown as PrismaClient), models, queryRaw };
}

/** Arrange a locked level with the given balances (the next raw query result). */
function lockLevel(
  queryRaw: ReturnType<typeof vi.fn>,
  models: ReturnType<typeof makeRepo>["models"],
  onHand = 10n,
  committed = 2n,
): void {
  queryRaw.mockResolvedValueOnce([]); // setTenantContext
  queryRaw.mockResolvedValueOnce([lockedRow(onHand, committed)]);
  models.inventoryStock.findFirstOrThrow.mockResolvedValue(
    stockRow({ onHand, committed, available: onHand - committed }),
  );
}

function variantFound(models: ReturnType<typeof makeRepo>["models"]): void {
  models.productVariant.findFirst.mockResolvedValue({
    id: VARIANT,
    product: { allowOversell: false },
  });
}

function uniqueViolation(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "6",
    meta: { target },
  });
}

describe("InventoryRepository — keyset cursors", () => {
  it("builds a name cursor predicate for the warehouse list", async () => {
    const { repo, models } = makeRepo();
    await repo.listWarehouses(COMPANY, {
      sort: { field: "name", dir: "asc" },
      active: true,
      cursor: encodeCursor({ p: "Main", t: "w1" }),
    });
    const args = models.warehouse.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(JSON.stringify(args.where["AND"])).toContain("Main");
  });

  it("builds a createdAt cursor predicate and rejects an unparseable date", async () => {
    const { repo, models } = makeRepo();
    await repo.listWarehouses(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
      active: true,
      cursor: encodeCursor({ p: CREATED.toISOString(), t: "w1" }),
    });
    expect(models.warehouse.findMany).toHaveBeenCalled();
    await expect(
      repo.listWarehouses(COMPANY, {
        sort: { field: "createdAt", dir: "desc" },
        active: true,
        cursor: encodeCursor({ p: "not-a-date", t: "w1" }),
      }),
    ).rejects.toBeInstanceOf(InvalidListCursorError);
  });

  it("rejects a cursor whose values are not strings", async () => {
    const { repo } = makeRepo();
    await expect(
      repo.listWarehouses(COMPANY, {
        sort: { field: "name", dir: "asc" },
        active: true,
        cursor: encodeCursor({ p: 1, t: 2 }),
      }),
    ).rejects.toBeInstanceOf(InvalidListCursorError);
  });

  it("builds an available cursor predicate and rejects a non-numeric one", async () => {
    const { repo, models } = makeRepo();
    await repo.listStock(COMPANY, {
      sort: { field: "available", dir: "asc" },
      belowReorder: false,
      cursor: encodeCursor({ p: "8", t: "s1" }),
    });
    expect(models.inventoryStock.findMany).toHaveBeenCalled();
    await expect(
      repo.listStock(COMPANY, {
        sort: { field: "available", dir: "asc" },
        belowReorder: false,
        cursor: encodeCursor({ p: "eight", t: "s1" }),
      }),
    ).rejects.toBeInstanceOf(InvalidListCursorError);
  });

  it("issues a next cursor from the last row of a full page", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.findMany.mockResolvedValue([
      warehouseRow({ id: "w1" }),
      warehouseRow({ id: "w2" }),
    ]);
    const page = await repo.listWarehouses(COMPANY, {
      sort: { field: "name", dir: "asc" },
      active: true,
      limit: 1,
    });
    expect(page.page.hasMore).toBe(true);
    expect(page.page.nextCursor).not.toBeNull();
  });

  it("issues a stock cursor from the available value", async () => {
    const { repo, models } = makeRepo();
    models.inventoryStock.findMany.mockResolvedValue([stockRow(), stockRow({ id: "s2" })]);
    const page = await repo.listStock(COMPANY, {
      sort: { field: "available", dir: "asc" },
      belowReorder: false,
      limit: 1,
    });
    expect(page.page.nextCursor).not.toBeNull();
  });
});

describe("InventoryRepository — warehouse updates", () => {
  it("maps each provided field onto the patch and leaves the rest alone", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue(warehouseRow());
    await repo.updateWarehouse(ACTOR_CTX, "w1", {
      name: "Depot",
      code: null,
      address: "Giza",
      active: false,
    });
    const args = models.warehouse.updateMany.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(args.data).toMatchObject({
      name: "Depot",
      code: null,
      address: "Giza",
      isActive: false,
    });
    expect(args.data).not.toHaveProperty("isDefault");
  });

  it("clears the other default when promoting a warehouse", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue(warehouseRow({ isDefault: true }));
    await repo.updateWarehouse(ACTOR_CTX, "w1", { isDefault: true });
    const clear = models.warehouse.updateMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(clear.where).toMatchObject({ isDefault: true, NOT: { id: "w1" } });
  });

  it("returns null when the warehouse is not in this tenant", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.updateMany.mockResolvedValue({ count: 0 });
    expect(await repo.updateWarehouse(ACTOR_CTX, "w9", { name: "x" })).toBeNull();
    expect(await repo.findWarehouse(COMPANY, "w9")).toBeNull();
  });

  it("maps a duplicate on update to the colliding field", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.updateMany.mockRejectedValue(
      uniqueViolation("warehouses_company_default_key"),
    );
    await expect(repo.updateWarehouse(ACTOR_CTX, "w1", { name: "M" })).rejects.toMatchObject({
      field: "isDefault",
    });
  });

  it("passes through an error that is not a unique violation", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.create.mockRejectedValue(new Error("connection lost"));
    await expect(repo.createWarehouse(ACTOR_CTX, { name: "M" })).rejects.toThrow("connection lost");
  });
});

describe("InventoryRepository — level locking", () => {
  it("carries on when a concurrent creator won the upsert race", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    variantFound(models);
    models.inventoryStock.upsert.mockRejectedValue(
      uniqueViolation("inventory_stock_warehouse_variant_key"),
    );
    lockLevel(queryRaw, models);
    models.stockReservation.create.mockResolvedValue(reservationRow());
    const result = await repo.reserve(ACTOR_CTX, {
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      quantity: 1,
    });
    expect(result.replayed).toBe(false);
  });

  it("rethrows an upsert failure that is not a unique violation", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    variantFound(models);
    models.inventoryStock.upsert.mockRejectedValue(new Error("deadlock"));
    await expect(
      repo.reserve(ACTOR_CTX, { warehouseId: WAREHOUSE, variantId: VARIANT, quantity: 1 }),
    ).rejects.toThrow("deadlock");
  });

  it("fails when no row came back locked", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    variantFound(models);
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([]); // nothing locked
    await expect(
      repo.reserve(ACTOR_CTX, { warehouseId: WAREHOUSE, variantId: VARIANT, quantity: 1 }),
    ).rejects.toBeInstanceOf(ReferenceNotFoundError);
  });

  it("rejects an unknown variant before locking anything", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    models.productVariant.findFirst.mockResolvedValue(null);
    await expect(
      repo.setReorderPoint(ACTOR_CTX, {
        warehouseId: WAREHOUSE,
        variantId: VARIANT,
        reorderPoint: 3,
      }),
    ).rejects.toBeInstanceOf(ReferenceNotFoundError);
    expect(models.inventoryStock.upsert).not.toHaveBeenCalled();
  });
});

describe("InventoryRepository — concurrent releases and replays", () => {
  it("replays when another transaction released the reservation first", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.stockReservation.findFirst
      .mockResolvedValueOnce(reservationRow())
      .mockResolvedValueOnce(reservationRow({ status: "released" }));
    lockLevel(queryRaw, models);
    models.stockReservation.updateMany.mockResolvedValue({ count: 0 });
    const result = await repo.release(ACTOR_CTX, "r1");
    expect(result?.replayed).toBe(true);
    expect(result?.record.status).toBe("released");
  });

  it("returns null when the row disappeared mid-release", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.stockReservation.findFirst
      .mockResolvedValueOnce(reservationRow())
      .mockResolvedValueOnce(null);
    lockLevel(queryRaw, models);
    models.stockReservation.updateMany.mockResolvedValue({ count: 0 });
    expect(await repo.release(ACTOR_CTX, "r1")).toBeNull();
  });

  it("falls back to the pre-release snapshot when the re-read comes back empty", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.stockReservation.findFirst
      .mockResolvedValueOnce(reservationRow())
      .mockResolvedValueOnce(null);
    lockLevel(queryRaw, models);
    models.stockReservation.updateMany.mockResolvedValue({ count: 1 });
    const result = await repo.release(ACTOR_CTX, "r1");
    expect(result?.record.id).toBe("r1");
    expect(result?.effects).toHaveLength(1);
  });

  it("replays a transfer whose key lost the insert race", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    variantFound(models);
    queryRaw.mockResolvedValueOnce([]);
    queryRaw.mockResolvedValueOnce([lockedRow(10n, 0n)]);
    queryRaw.mockResolvedValueOnce([lockedRow(0n, 0n)]);
    models.inventoryStock.findFirstOrThrow.mockResolvedValue(stockRow());
    models.stockTransfer.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(transferRow());
    models.stockTransfer.create.mockRejectedValue(
      uniqueViolation("stock_transfers_idempotency_key"),
    );
    const result = await repo.transfer(ACTOR_CTX, {
      fromWarehouseId: WAREHOUSE,
      toWarehouseId: OTHER,
      variantId: VARIANT,
      quantity: 3,
      idempotencyKey: "k1",
    });
    expect(result.replayed).toBe(true);
    expect(models.inventoryStock.updateMany).not.toHaveBeenCalled();
  });

  it("replays a stored adjustment for a repeated key", async () => {
    const { repo, models } = makeRepo();
    models.stockAdjustment.findFirst.mockResolvedValue(adjustmentRow());
    const result = await repo.adjust(ACTOR_CTX, {
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      quantityDelta: -3,
      reason: "damage",
      idempotencyKey: "k1",
    });
    expect(result.replayed).toBe(true);
    expect(result.record.reason).toBe("damage");
  });

  it("replays an adjustment whose key lost the insert race", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    variantFound(models);
    lockLevel(queryRaw, models, 10n, 0n);
    models.stockAdjustment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(adjustmentRow());
    models.stockAdjustment.create.mockRejectedValue(
      uniqueViolation("stock_adjustments_idempotency_key"),
    );
    const result = await repo.adjust(ACTOR_CTX, {
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      quantityDelta: -3,
      reason: "damage",
      idempotencyKey: "k1",
    });
    expect(result.replayed).toBe(true);
  });

  it("rethrows when the key raced but nothing was stored", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    variantFound(models);
    lockLevel(queryRaw, models);
    models.stockReservation.findFirst.mockResolvedValue(null);
    models.stockReservation.create.mockRejectedValue(
      uniqueViolation("stock_reservations_idempotency_key"),
    );
    await expect(
      repo.reserve(ACTOR_CTX, {
        warehouseId: WAREHOUSE,
        variantId: VARIANT,
        quantity: 1,
        idempotencyKey: "k1",
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
