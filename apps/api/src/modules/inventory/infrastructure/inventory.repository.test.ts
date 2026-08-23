import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@cadeau/database";
import {
  DuplicateWarehouseError,
  InsufficientStockError,
  InvalidListCursorError,
  ReferenceNotFoundError,
} from "../domain/inventory.errors";
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
    companyMember: delegate(),
    warehouseJoinCode: delegate(),
  };
  // The last raw result wins; `setTenantContext` also goes through $queryRaw, so
  // tests queue lock rows explicitly with `mockResolvedValueOnce`.
  const queryRaw = vi.fn().mockResolvedValue([]);
  const txHost = { $queryRaw: queryRaw, ...models };
  const prisma = {
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(txHost)),
    inventoryStock: { fields: { reorderPoint: Symbol("reorderPoint") } },
  };
  const repo = new InventoryRepository(prisma as unknown as PrismaClient);
  return { repo, models, queryRaw };
}

/** Arrange a locked level with the given balances (the next raw query result). */
function lockLevel(
  queryRaw: ReturnType<typeof vi.fn>,
  models: ReturnType<typeof makeRepo>["models"],
  onHand = 10n,
  committed = 2n,
  reorderPoint = 0n,
): void {
  queryRaw.mockResolvedValueOnce([]); // setTenantContext
  queryRaw.mockResolvedValueOnce([lockedRow(onHand, committed, reorderPoint)]);
  models.inventoryStock.findFirstOrThrow.mockResolvedValue(
    stockRow({ onHand, committed, available: onHand - committed, reorderPoint }),
  );
}

/** A found variant whose product does (or does not) allow overselling. */
function variantFound(models: ReturnType<typeof makeRepo>["models"], allowOversell = false): void {
  models.productVariant.findFirst.mockResolvedValue({
    id: VARIANT,
    product: { allowOversell },
  });
}

function uniqueViolation(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "6",
    meta: { target },
  });
}

describe("InventoryRepository — warehouses", () => {
  it("maps a warehouse row to the public view and binds the RLS context", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.warehouse.findFirst.mockResolvedValueOnce(warehouseRow({ code: "MAIN" }));
    const view = await repo.findWarehouse(COMPANY, "w1");
    expect(queryRaw).toHaveBeenCalled(); // setTenantContext ran
    expect(view).toEqual({
      id: "w1",
      name: "Main",
      code: "MAIN",
      address: null,
      isDefault: false,
      active: true,
      createdAt: CREATED.toISOString(),
      updatedAt: UPDATED.toISOString(),
    });
  });

  it("scopes the list to the tenant, the active filter, and the search term", async () => {
    const { repo, models } = makeRepo();
    await repo.listWarehouses(COMPANY, {
      sort: { field: "name", dir: "asc" },
      active: true,
      q: "main",
    });
    const args = models.warehouse.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ companyId: COMPANY, isActive: true });
    expect(args.where["OR"]).toHaveLength(2);
  });

  it("omits the active filter when the caller asked for all", async () => {
    const { repo, models } = makeRepo();
    await repo.listWarehouses(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
      active: "all",
    });
    const args = models.warehouse.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where).not.toHaveProperty("isActive");
  });

  it("rejects a tampered cursor", async () => {
    const { repo } = makeRepo();
    await expect(
      repo.listWarehouses(COMPANY, {
        sort: { field: "createdAt", dir: "desc" },
        active: true,
        cursor: "not-a-cursor",
      }),
    ).rejects.toBeInstanceOf(InvalidListCursorError);
  });

  it("clears the previous default when a new default is created", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.create.mockResolvedValue(warehouseRow({ isDefault: true }));
    await repo.createWarehouse(ACTOR_CTX, { name: "Main", isDefault: true });
    expect(models.warehouse.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: COMPANY, isDefault: true }),
      }),
    );
  });

  it("maps unique violations to the field that collided", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.create.mockRejectedValueOnce(uniqueViolation("warehouses_company_code_key"));
    await expect(repo.createWarehouse(ACTOR_CTX, { name: "M" })).rejects.toMatchObject({
      field: "code",
    });
    models.warehouse.create.mockRejectedValueOnce(uniqueViolation("warehouses_company_name_key"));
    await expect(repo.createWarehouse(ACTOR_CTX, { name: "M" })).rejects.toBeInstanceOf(
      DuplicateWarehouseError,
    );
  });

  it("returns null when archiving a warehouse that is not in this tenant", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.updateMany.mockResolvedValue({ count: 0 });
    expect(await repo.archiveWarehouse(ACTOR_CTX, "w9")).toBeNull();
  });

  it("drops the default flag when archiving", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue(warehouseRow({ isActive: false }));
    await repo.archiveWarehouse(ACTOR_CTX, "w1");
    const args = models.warehouse.updateMany.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(args.data).toMatchObject({ isActive: false, isDefault: false });
  });
});

describe("InventoryRepository — findMemberWarehouseScope (Vendor Accounts, Phase 1)", () => {
  it("returns the member's warehouseId when set", async () => {
    const { repo, models } = makeRepo();
    models.companyMember.findFirst.mockResolvedValueOnce({ warehouseId: WAREHOUSE });
    expect(await repo.findMemberWarehouseScope(ACTOR, COMPANY)).toBe(WAREHOUSE);
  });

  it("returns null for an unscoped or unknown member", async () => {
    const { repo, models } = makeRepo();
    models.companyMember.findFirst.mockResolvedValueOnce({ warehouseId: null });
    expect(await repo.findMemberWarehouseScope(ACTOR, COMPANY)).toBeNull();
    models.companyMember.findFirst.mockResolvedValueOnce(null);
    expect(await repo.findMemberWarehouseScope(ACTOR, COMPANY)).toBeNull();
  });
});

describe("InventoryRepository — warehouse join codes (Vendor Accounts, Phase 1)", () => {
  it("status: no row yet", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.findFirst.mockResolvedValueOnce({ id: "w1" });
    models.warehouseJoinCode.findFirst.mockResolvedValueOnce(null);
    expect(await repo.getWarehouseJoinCodeStatus(COMPANY, "w1")).toEqual({ exists: false });
  });

  it("status: existing row, never the plaintext/hash", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.findFirst.mockResolvedValueOnce({ id: "w1" });
    models.warehouseJoinCode.findFirst.mockResolvedValueOnce({
      isActive: true,
      createdAt: CREATED,
    });
    const status = await repo.getWarehouseJoinCodeStatus(COMPANY, "w1");
    expect(status).toEqual({ exists: true, isActive: true, createdAt: CREATED.toISOString() });
    expect(JSON.stringify(status)).not.toMatch(/hash|code/i);
  });

  it("status: null when the warehouse itself is unknown in this tenant", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.findFirst.mockResolvedValueOnce(null);
    expect(await repo.getWarehouseJoinCodeStatus(COMPANY, "w9")).toBeNull();
  });

  it("rotate: upserts on the warehouse's unique slot, given an already-hashed code", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.findFirst.mockResolvedValueOnce({ id: "w1" });
    models.warehouseJoinCode.upsert.mockResolvedValueOnce({ createdAt: CREATED });
    const result = await repo.rotateWarehouseJoinCode(ACTOR_CTX, "w1", "already-hashed");
    expect(result).toEqual({ createdAt: CREATED.toISOString() });
    const args = models.warehouseJoinCode.upsert.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(args.where).toEqual({ warehouseId: "w1" });
    expect(args.create).toMatchObject({ codeHash: "already-hashed", isActive: true });
    expect(args.update).toMatchObject({ codeHash: "already-hashed", isActive: true });
  });

  it("rotate: null when the warehouse itself is unknown in this tenant", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.findFirst.mockResolvedValueOnce(null);
    expect(await repo.rotateWarehouseJoinCode(ACTOR_CTX, "w9", "hash")).toBeNull();
    expect(models.warehouseJoinCode.upsert).not.toHaveBeenCalled();
  });

  it("revoke: sets is_active = false, scoped to the tenant", async () => {
    const { repo, models } = makeRepo();
    models.warehouseJoinCode.updateMany.mockResolvedValueOnce({ count: 1 });
    expect(await repo.revokeWarehouseJoinCode(ACTOR_CTX, "w1")).toBe(true);
    const args = models.warehouseJoinCode.updateMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({ warehouseId: "w1", companyId: COMPANY });
    expect(args.data).toMatchObject({ isActive: false });
  });

  it("revoke: false when no code exists for this warehouse in this tenant", async () => {
    const { repo, models } = makeRepo();
    models.warehouseJoinCode.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await repo.revokeWarehouseJoinCode(ACTOR_CTX, "w9")).toBe(false);
  });
});

describe("InventoryRepository — stock levels", () => {
  it("maps a stock row to the public view", async () => {
    const { repo, models } = makeRepo();
    models.inventoryStock.findMany.mockResolvedValue([stockRow({ reorderPoint: 5n })]);
    const page = await repo.listStock(COMPANY, {
      sort: { field: "updatedAt", dir: "desc" },
      belowReorder: false,
    });
    expect(page.data[0]).toEqual({
      id: "s1",
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      variantName: "Red / L",
      productId: PRODUCT,
      productName: "Satin bouquet",
      sku: "SKU-1",
      imageUrl: IMAGE,
      onHand: 10,
      committed: 2,
      available: 8,
      reorderPoint: 5,
      updatedAt: UPDATED.toISOString(),
    });
  });

  it("reads the variant's catalog identity in the same query, not a second one", async () => {
    const { repo, models } = makeRepo();
    models.inventoryStock.findMany.mockResolvedValue([stockRow()]);
    await repo.listStock(COMPANY, {
      sort: { field: "updatedAt", dir: "desc" },
      belowReorder: false,
    });
    const args = models.inventoryStock.findMany.mock.calls[0]?.[0] as {
      select: {
        variant?: {
          select: { name: boolean; sku: boolean; product: { select: Record<string, boolean> } };
        };
      };
    };
    expect(args.select.variant?.select).toMatchObject({ name: true, sku: true });
    expect(args.select.variant?.select.product.select).toMatchObject({
      id: true,
      name: true,
      imageUrl: true,
    });
  });

  it("filters to levels at or below a set reorder point", async () => {
    const { repo, models } = makeRepo();
    await repo.listStock(COMPANY, {
      sort: { field: "available", dir: "asc" },
      belowReorder: true,
    });
    const args = models.inventoryStock.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(args.where["reorderPoint"]).toEqual({ gt: 0 });
    expect(args.where).toHaveProperty("available");
  });

  it("passes the warehouse and variant filters through", async () => {
    const { repo, models } = makeRepo();
    await repo.listStock(COMPANY, {
      sort: { field: "updatedAt", dir: "desc" },
      belowReorder: false,
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
    });
    const args = models.inventoryStock.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({
      companyId: COMPANY,
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
    });
  });

  it("upserts the level before setting a reorder point", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    variantFound(models);
    lockLevel(queryRaw, models, 10n, 2n, 7n);
    const level = await repo.setReorderPoint(ACTOR_CTX, {
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      reorderPoint: 7,
    });
    expect(models.inventoryStock.upsert).toHaveBeenCalled();
    expect(level.reorderPoint).toBe(7);
  });
});

describe("InventoryRepository — reserve", () => {
  it("locks the level, commits the units, and reports the effect", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    variantFound(models);
    lockLevel(queryRaw, models, 10n, 2n);
    models.stockReservation.create.mockResolvedValue(reservationRow());

    const result = await repo.reserve(ACTOR_CTX, {
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      quantity: 2,
    });

    // The lock query ran before the write.
    expect(String(queryRaw.mock.calls[1]?.[0])).toContain("FOR UPDATE");
    expect(result.replayed).toBe(false);
    expect(result.record.id).toBe("r1");
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0]).toMatchObject({
      committedDelta: 2,
      onHandDelta: 0,
      reason: "reserved",
    });
    const args = models.inventoryStock.updateMany.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(args.data["committed"]).toEqual({ increment: 2n });
  });

  it("refuses to oversell when available is short", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    variantFound(models);
    lockLevel(queryRaw, models, 10n, 9n); // available = 1
    await expect(
      repo.reserve(ACTOR_CTX, { warehouseId: WAREHOUSE, variantId: VARIANT, quantity: 5 }),
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect(models.stockReservation.create).not.toHaveBeenCalled();
  });

  it("allows overselling when the product's policy permits it", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    variantFound(models, true);
    lockLevel(queryRaw, models, 0n, 0n);
    models.stockReservation.create.mockResolvedValue(reservationRow({ quantity: 5n }));
    const result = await repo.reserve(ACTOR_CTX, {
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      quantity: 5,
    });
    expect(result.record.quantity).toBe(5);
  });

  it("rejects an inactive or foreign warehouse", async () => {
    const { repo, models } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue(null);
    await expect(
      repo.reserve(ACTOR_CTX, { warehouseId: WAREHOUSE, variantId: VARIANT, quantity: 1 }),
    ).rejects.toBeInstanceOf(ReferenceNotFoundError);
  });

  it("replays a stored reservation for a repeated idempotency key", async () => {
    const { repo, models } = makeRepo();
    models.stockReservation.findFirst.mockResolvedValue(reservationRow());
    const result = await repo.reserve(ACTOR_CTX, {
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      quantity: 2,
      idempotencyKey: "k1",
    });
    expect(result.replayed).toBe(true);
    expect(result.effects).toEqual([]);
    expect(models.inventoryStock.updateMany).not.toHaveBeenCalled();
  });

  it("replays when two requests with the same key race on the insert", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    variantFound(models);
    lockLevel(queryRaw, models);
    models.stockReservation.findFirst
      .mockResolvedValueOnce(null) // pre-check: not stored yet
      .mockResolvedValueOnce(reservationRow()); // after the race: the winner's row
    models.stockReservation.create.mockRejectedValue(
      uniqueViolation("stock_reservations_idempotency_key"),
    );
    const result = await repo.reserve(ACTOR_CTX, {
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      quantity: 2,
      idempotencyKey: "k1",
    });
    expect(result.replayed).toBe(true);
    expect(models.inventoryStock.updateMany).not.toHaveBeenCalled();
  });

  it("rethrows a unique violation that is not the idempotency key", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    variantFound(models);
    lockLevel(queryRaw, models);
    models.stockReservation.create.mockRejectedValue(uniqueViolation("something_else"));
    await expect(
      repo.reserve(ACTOR_CTX, { warehouseId: WAREHOUSE, variantId: VARIANT, quantity: 1 }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("InventoryRepository — release", () => {
  it("releases an active reservation and lowers committed", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.stockReservation.findFirst.mockResolvedValue(reservationRow());
    lockLevel(queryRaw, models, 10n, 2n);
    const result = await repo.release(ACTOR_CTX, "r1");
    expect(result?.replayed).toBe(false);
    expect(result?.effects[0]).toMatchObject({ committedDelta: -2, reason: "released" });
  });

  it("never drives committed below zero", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.stockReservation.findFirst.mockResolvedValue(reservationRow({ quantity: 9n }));
    lockLevel(queryRaw, models, 10n, 3n); // only 3 committed units exist
    const result = await repo.release(ACTOR_CTX, "r1");
    expect(result?.effects[0]?.committedDelta).toBe(-3);
  });

  it("returns null for an unknown reservation", async () => {
    const { repo } = makeRepo();
    expect(await repo.release(ACTOR_CTX, "r9")).toBeNull();
  });

  it("treats an already-released reservation as a replay", async () => {
    const { repo, models } = makeRepo();
    models.stockReservation.findFirst.mockResolvedValue(reservationRow({ status: "released" }));
    const result = await repo.release(ACTOR_CTX, "r1");
    expect(result?.replayed).toBe(true);
    expect(result?.effects).toEqual([]);
    expect(models.inventoryStock.updateMany).not.toHaveBeenCalled();
  });
});

describe("InventoryRepository — transfer", () => {
  it("moves stock out of the source and into the target", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    variantFound(models);
    queryRaw.mockResolvedValueOnce([]); // setTenantContext
    queryRaw.mockResolvedValueOnce([lockedRow(10n, 0n)]); // first (sorted) side
    queryRaw.mockResolvedValueOnce([lockedRow(4n, 0n)]); // second side
    models.inventoryStock.findFirstOrThrow.mockResolvedValue(stockRow());
    models.stockTransfer.create.mockResolvedValue({
      id: "t1",
      fromWarehouseId: WAREHOUSE,
      toWarehouseId: OTHER,
      variantId: VARIANT,
      quantity: 3n,
      note: null,
      createdAt: CREATED,
    });

    const result = await repo.transfer(ACTOR_CTX, {
      fromWarehouseId: WAREHOUSE,
      toWarehouseId: OTHER,
      variantId: VARIANT,
      quantity: 3,
    });

    expect(result.effects).toHaveLength(2);
    expect(result.effects[0]).toMatchObject({ onHandDelta: -3, warehouseId: WAREHOUSE });
    expect(result.effects[1]).toMatchObject({ onHandDelta: 3, warehouseId: OTHER });
  });

  it("refuses to move more than the source holds", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    variantFound(models);
    queryRaw.mockResolvedValueOnce([]);
    queryRaw.mockResolvedValueOnce([lockedRow(1n, 0n)]);
    queryRaw.mockResolvedValueOnce([lockedRow(0n, 0n)]);
    await expect(
      repo.transfer(ACTOR_CTX, {
        fromWarehouseId: WAREHOUSE,
        toWarehouseId: OTHER,
        variantId: VARIANT,
        quantity: 9,
      }),
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect(models.stockTransfer.create).not.toHaveBeenCalled();
  });

  it("replays a stored transfer for a repeated idempotency key", async () => {
    const { repo, models } = makeRepo();
    models.stockTransfer.findFirst.mockResolvedValue({
      id: "t1",
      fromWarehouseId: WAREHOUSE,
      toWarehouseId: OTHER,
      variantId: VARIANT,
      quantity: 3n,
      note: null,
      createdAt: CREATED,
    });
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
});

describe("InventoryRepository — adjust", () => {
  function adjustmentRow(extra: Record<string, unknown> = {}) {
    return {
      id: "a1",
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      quantityDelta: -3n,
      reason: "damage",
      note: null,
      createdAt: CREATED,
      ...extra,
    };
  }

  it("applies a signed delta to on-hand", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    variantFound(models);
    lockLevel(queryRaw, models, 10n, 0n);
    models.stockAdjustment.create.mockResolvedValue(adjustmentRow());
    const result = await repo.adjust(ACTOR_CTX, {
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      quantityDelta: -3,
      reason: "damage",
    });
    expect(result.record.quantityDelta).toBe(-3);
    expect(result.effects[0]).toMatchObject({ onHandDelta: -3, reason: "adjusted" });
  });

  it("refuses an adjustment that would drive on-hand negative", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    variantFound(models);
    lockLevel(queryRaw, models, 2n, 0n);
    await expect(
      repo.adjust(ACTOR_CTX, {
        warehouseId: WAREHOUSE,
        variantId: VARIANT,
        quantityDelta: -5,
        reason: "loss",
      }),
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect(models.stockAdjustment.create).not.toHaveBeenCalled();
  });

  it("flags the write that crossed the reorder threshold", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    variantFound(models);
    // Before: available 10, threshold 5. After: available 3 → crossed.
    queryRaw.mockResolvedValueOnce([]);
    queryRaw.mockResolvedValueOnce([lockedRow(10n, 0n, 5n)]);
    models.inventoryStock.findFirstOrThrow.mockResolvedValue(
      stockRow({ onHand: 3n, committed: 0n, available: 3n, reorderPoint: 5n }),
    );
    models.stockAdjustment.create.mockResolvedValue(adjustmentRow({ quantityDelta: -7n }));
    const result = await repo.adjust(ACTOR_CTX, {
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      quantityDelta: -7,
      reason: "count",
    });
    expect(result.effects[0]?.crossedLow).toBe(true);
  });

  it("does not re-flag a level that was already low", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    variantFound(models);
    // Before: available 4, threshold 5 → already below; after: 3.
    queryRaw.mockResolvedValueOnce([]);
    queryRaw.mockResolvedValueOnce([lockedRow(4n, 0n, 5n)]);
    models.inventoryStock.findFirstOrThrow.mockResolvedValue(
      stockRow({ onHand: 3n, committed: 0n, available: 3n, reorderPoint: 5n }),
    );
    models.stockAdjustment.create.mockResolvedValue(adjustmentRow({ quantityDelta: -1n }));
    const result = await repo.adjust(ACTOR_CTX, {
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      quantityDelta: -1,
      reason: "count",
    });
    expect(result.effects[0]?.crossedLow).toBe(false);
  });
});
