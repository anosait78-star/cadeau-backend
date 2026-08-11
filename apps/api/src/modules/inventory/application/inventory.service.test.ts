import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppException } from "../../../shared/errors/app-exception";
import type { EventBusPort } from "../../../shared/events/event-bus.port";
import type { Clock } from "../../../shared/time/clock";
import type { InventoryAuditPort } from "../domain/inventory-audit.port";
import type { InventoryRepositoryPort } from "../domain/inventory-repository.port";
import type {
  ReservationView,
  StockEffect,
  StockLevelView,
  WarehouseView,
} from "../domain/inventory.entity";
import {
  DuplicateWarehouseError,
  InsufficientStockError,
  InvalidListCursorError,
  ReferenceNotFoundError,
} from "../domain/inventory.errors";
import { InventoryService } from "./inventory.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const WAREHOUSE = "33333333-3333-3333-3333-333333333333";
const OTHER_WAREHOUSE = "44444444-4444-4444-4444-444444444444";
const VARIANT = "55555555-5555-5555-5555-555555555555";

function principal(overrides: Partial<RequestPrincipal> = {}): RequestPrincipal {
  return { userId: USER, sessionId: "s", companyId: COMPANY, ...overrides };
}

function warehouse(id = "w1", extra: Partial<WarehouseView> = {}): WarehouseView {
  return {
    id,
    name: "Main",
    code: null,
    address: null,
    isDefault: false,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function level(extra: Partial<StockLevelView> = {}): StockLevelView {
  return {
    id: "s1",
    warehouseId: WAREHOUSE,
    variantId: VARIANT,
    onHand: 10,
    committed: 2,
    available: 8,
    reorderPoint: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function effect(extra: Partial<StockEffect> = {}): StockEffect {
  return {
    warehouseId: WAREHOUSE,
    variantId: VARIANT,
    reason: "reserved",
    onHandDelta: 0,
    committedDelta: 2,
    level: level(),
    crossedLow: false,
    ...extra,
  };
}

function reservation(extra: Partial<ReservationView> = {}): ReservationView {
  return {
    id: "r1",
    warehouseId: WAREHOUSE,
    variantId: VARIANT,
    quantity: 2,
    orderId: null,
    reference: null,
    status: "active",
    releasedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function emptyPage<T>(): KeysetPage<T> {
  return { data: [], page: { limit: 25, nextCursor: null, hasMore: false } };
}

interface Harness {
  service: InventoryService;
  repo: Record<keyof InventoryRepositoryPort, ReturnType<typeof vi.fn>>;
  audit: { record: ReturnType<typeof vi.fn> };
  events: { publish: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };
}

function makeHarness(): Harness {
  const repo = {
    listWarehouses: vi.fn().mockResolvedValue(emptyPage()),
    findWarehouse: vi.fn(),
    createWarehouse: vi.fn(),
    updateWarehouse: vi.fn(),
    archiveWarehouse: vi.fn(),
    listStock: vi.fn().mockResolvedValue(emptyPage()),
    setReorderPoint: vi.fn(),
    setVariantWarehouse: vi.fn(),
    reserve: vi.fn(),
    release: vi.fn(),
    transfer: vi.fn(),
    adjust: vi.fn(),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const events = { publish: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn() };
  const clock: Clock = { now: () => 1_700_000_000_000 };
  const service = new InventoryService(
    repo as unknown as InventoryRepositoryPort,
    audit as unknown as InventoryAuditPort,
    events as unknown as EventBusPort,
    clock,
  );
  return { service, repo, audit, events };
}

/** Assert a thrown AppException carries the expected HTTP status. */
async function expectStatus(promise: Promise<unknown>, status: number): Promise<AppException> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).getStatus()).toBe(status);
  return error as AppException;
}

describe("InventoryService — tenant scope", () => {
  it("refuses every operation without an active company", async () => {
    const { service } = makeHarness();
    const p = principal({ companyId: null });
    await expectStatus(service.listWarehouses(p, {}), 403);
    await expectStatus(service.listStock(p, {}), 403);
    await expectStatus(
      service.reserve(p, { warehouseId: WAREHOUSE, variantId: VARIANT, quantity: 1 }),
      403,
    );
  });
});

describe("InventoryService — warehouses", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("rejects an invalid list query before touching the repository", async () => {
    await expectStatus(h.service.listWarehouses(principal(), { sort: "bogus" }), 400);
    expect(h.repo.listWarehouses).not.toHaveBeenCalled();
  });

  it("creates and audits a warehouse", async () => {
    h.repo.createWarehouse.mockResolvedValue(warehouse());
    const row = await h.service.createWarehouse(principal(), { name: "Main" });
    expect(row.id).toBe("w1");
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY,
        actorId: USER,
        action: "inventory.warehouse_created",
        entityType: "warehouse",
        entityId: "w1",
      }),
    );
  });

  it("maps a duplicate name to 409", async () => {
    h.repo.createWarehouse.mockRejectedValue(new DuplicateWarehouseError("name"));
    await expectStatus(h.service.createWarehouse(principal(), { name: "Main" }), 409);
    expect(h.audit.record).not.toHaveBeenCalled();
  });

  it("maps a missing warehouse to 404 on update and archive", async () => {
    h.repo.updateWarehouse.mockResolvedValue(null);
    h.repo.archiveWarehouse.mockResolvedValue(null);
    await expectStatus(h.service.updateWarehouse(principal(), "w9", { name: "x" }), 404);
    await expectStatus(h.service.archiveWarehouse(principal(), "w9"), 404);
  });

  it("maps an invalid cursor to 400", async () => {
    h.repo.listWarehouses.mockRejectedValue(new InvalidListCursorError());
    await expectStatus(h.service.listWarehouses(principal(), { cursor: "junk" }), 400);
  });

  it("returns a warehouse detail, or 404 when it is not in this tenant", async () => {
    h.repo.findWarehouse.mockResolvedValueOnce(warehouse());
    expect((await h.service.getWarehouse(principal(), "w1")).id).toBe("w1");
    h.repo.findWarehouse.mockResolvedValueOnce(null);
    await expectStatus(h.service.getWarehouse(principal(), "w9"), 404);
  });

  it("audits an update and an archive", async () => {
    h.repo.updateWarehouse.mockResolvedValue(warehouse("w1", { name: "Depot" }));
    h.repo.archiveWarehouse.mockResolvedValue(warehouse("w1", { active: false }));
    await h.service.updateWarehouse(principal(), "w1", { name: "Depot" });
    await h.service.archiveWarehouse(principal(), "w1");
    const actions = h.audit.record.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(actions).toEqual(["inventory.warehouse_updated", "inventory.warehouse_archived"]);
  });

  it("passes an unrecognized error through untouched", async () => {
    const boom = new Error("connection lost");
    h.repo.createWarehouse.mockRejectedValue(boom);
    await expect(h.service.createWarehouse(principal(), { name: "M" })).rejects.toBe(boom);
  });
});

describe("InventoryService — stock reads", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("rejects an invalid stock query before touching the repository", async () => {
    await expectStatus(h.service.listStock(principal(), { belowReorder: "maybe" }), 400);
    expect(h.repo.listStock).not.toHaveBeenCalled();
  });

  it("maps an invalid stock cursor to 400", async () => {
    h.repo.listStock.mockRejectedValue(new InvalidListCursorError());
    await expectStatus(h.service.listStock(principal(), { cursor: "junk" }), 400);
  });

  it("maps an unknown warehouse on a reorder-point write to 422", async () => {
    h.repo.setReorderPoint.mockRejectedValue(new ReferenceNotFoundError("warehouseId"));
    await expectStatus(
      h.service.setReorderPoint(principal(), {
        warehouseId: WAREHOUSE,
        variantId: VARIANT,
        reorderPoint: 3,
      }),
      422,
    );
    expect(h.audit.record).not.toHaveBeenCalled();
  });
});

describe("InventoryService — reserve", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("audits and emits stock.changed for the affected level", async () => {
    h.repo.reserve.mockResolvedValue({
      record: reservation(),
      effects: [effect()],
      replayed: false,
    });
    const row = await h.service.reserve(principal(), {
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      quantity: 2,
    });
    expect(row.id).toBe("r1");
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "inventory.reserved", entityType: "stock_reservation" }),
    );
    expect(h.events.publish).toHaveBeenCalledTimes(1);
    expect(h.events.publish).toHaveBeenCalledWith({
      type: "stock.changed",
      companyId: COMPANY,
      actorId: USER,
      occurredAt: 1_700_000_000_000,
      payload: {
        warehouseId: WAREHOUSE,
        variantId: VARIANT,
        onHandDelta: 0,
        committedDelta: 2,
        onHand: 10,
        committed: 2,
        available: 8,
        reason: "reserved",
      },
    });
  });

  it("emits stock.low as well when the write crossed the reorder point", async () => {
    h.repo.reserve.mockResolvedValue({
      record: reservation(),
      effects: [effect({ crossedLow: true, level: level({ available: 1, reorderPoint: 5 }) })],
      replayed: false,
    });
    await h.service.reserve(principal(), {
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      quantity: 2,
    });
    expect(h.events.publish).toHaveBeenCalledTimes(2);
    expect(h.events.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "stock.low",
        payload: {
          warehouseId: WAREHOUSE,
          variantId: VARIANT,
          available: 1,
          reorderPoint: 5,
        },
      }),
    );
  });

  it("neither audits nor emits on an idempotent replay", async () => {
    h.repo.reserve.mockResolvedValue({ record: reservation(), effects: [], replayed: true });
    const row = await h.service.reserve(principal(), {
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      quantity: 2,
      idempotencyKey: "k1",
    });
    expect(row.id).toBe("r1");
    expect(h.audit.record).not.toHaveBeenCalled();
    expect(h.events.publish).not.toHaveBeenCalled();
  });

  it("maps insufficient stock to 409", async () => {
    h.repo.reserve.mockRejectedValue(new InsufficientStockError(5, 2));
    const error = await expectStatus(
      h.service.reserve(principal(), {
        warehouseId: WAREHOUSE,
        variantId: VARIANT,
        quantity: 5,
      }),
      409,
    );
    expect(JSON.stringify(error.getResponse())).toContain("quantity");
  });

  it("maps an unknown variant to 422", async () => {
    h.repo.reserve.mockRejectedValue(new ReferenceNotFoundError("variantId"));
    await expectStatus(
      h.service.reserve(principal(), {
        warehouseId: WAREHOUSE,
        variantId: VARIANT,
        quantity: 1,
      }),
      422,
    );
  });
});

describe("InventoryService — release", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("emits the committed decrease", async () => {
    h.repo.release.mockResolvedValue({
      record: reservation({ status: "released", releasedAt: "2026-01-02T00:00:00.000Z" }),
      effects: [effect({ reason: "released", committedDelta: -2 })],
      replayed: false,
    });
    const row = await h.service.release(principal(), "r1");
    expect(row.status).toBe("released");
    expect(h.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "stock.changed",
        payload: expect.objectContaining({ committedDelta: -2, reason: "released" }),
      }),
    );
  });

  it("maps an unknown reservation to 404", async () => {
    h.repo.release.mockResolvedValue(null);
    await expectStatus(h.service.release(principal(), "r9"), 404);
  });

  it("stays silent when the reservation was already released", async () => {
    h.repo.release.mockResolvedValue({
      record: reservation({ status: "released" }),
      effects: [],
      replayed: true,
    });
    await h.service.release(principal(), "r1");
    expect(h.events.publish).not.toHaveBeenCalled();
    expect(h.audit.record).not.toHaveBeenCalled();
  });
});

describe("InventoryService — transfer", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("rejects a transfer to the same warehouse before touching the repository", async () => {
    await expectStatus(
      h.service.transfer(principal(), {
        fromWarehouseId: WAREHOUSE,
        toWarehouseId: WAREHOUSE,
        variantId: VARIANT,
        quantity: 1,
      }),
      400,
    );
    expect(h.repo.transfer).not.toHaveBeenCalled();
  });

  it("emits one stock.changed per side", async () => {
    h.repo.transfer.mockResolvedValue({
      record: {
        id: "t1",
        fromWarehouseId: WAREHOUSE,
        toWarehouseId: OTHER_WAREHOUSE,
        variantId: VARIANT,
        quantity: 3,
        note: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      effects: [
        effect({ reason: "transferred", onHandDelta: -3, committedDelta: 0 }),
        effect({
          reason: "transferred",
          onHandDelta: 3,
          committedDelta: 0,
          warehouseId: OTHER_WAREHOUSE,
        }),
      ],
      replayed: false,
    });
    await h.service.transfer(principal(), {
      fromWarehouseId: WAREHOUSE,
      toWarehouseId: OTHER_WAREHOUSE,
      variantId: VARIANT,
      quantity: 3,
    });
    expect(h.events.publish).toHaveBeenCalledTimes(2);
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "inventory.transferred", entityType: "stock_transfer" }),
    );
  });
});

describe("InventoryService — adjust + reorder points", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("audits an adjustment and emits its effect", async () => {
    h.repo.adjust.mockResolvedValue({
      record: {
        id: "a1",
        warehouseId: WAREHOUSE,
        variantId: VARIANT,
        quantityDelta: -3,
        reason: "damage" as const,
        note: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      effects: [effect({ reason: "adjusted", onHandDelta: -3, committedDelta: 0 })],
      replayed: false,
    });
    const row = await h.service.adjust(principal(), {
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      quantityDelta: -3,
      reason: "damage",
    });
    expect(row.id).toBe("a1");
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "inventory.adjusted", entityType: "stock_adjustment" }),
    );
    expect(h.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ onHandDelta: -3, reason: "adjusted" }),
      }),
    );
  });

  it("maps an adjustment below zero to 409", async () => {
    h.repo.adjust.mockRejectedValue(new InsufficientStockError(9, 4, "quantityDelta"));
    await expectStatus(
      h.service.adjust(principal(), {
        warehouseId: WAREHOUSE,
        variantId: VARIANT,
        quantityDelta: -9,
        reason: "count",
      }),
      409,
    );
  });

  it("audits a reorder-point change without emitting a stock event", async () => {
    h.repo.setReorderPoint.mockResolvedValue(level({ reorderPoint: 5 }));
    const row = await h.service.setReorderPoint(principal(), {
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      reorderPoint: 5,
    });
    expect(row.reorderPoint).toBe(5);
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "inventory.reorder_point_set",
        entityType: "inventory_stock",
      }),
    );
    expect(h.events.publish).not.toHaveBeenCalled();
  });
});
