import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { InventoryService } from "../application/inventory.service";
import type {
  AdjustmentView,
  ReservationView,
  StockLevelView,
  TransferView,
  WarehouseView,
} from "../domain/inventory.entity";
import { InventoryController } from "./inventory.controller";
import { WarehousesController } from "./warehouses.controller";

const WAREHOUSE = "33333333-3333-3333-3333-333333333333";
const OTHER = "44444444-4444-4444-4444-444444444444";
const VARIANT = "55555555-5555-5555-5555-555555555555";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

function warehouse(id = "w1"): WarehouseView {
  return {
    id,
    name: "Main",
    code: "MAIN",
    address: null,
    isDefault: true,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function level(): StockLevelView {
  return {
    id: "s1",
    warehouseId: WAREHOUSE,
    variantId: VARIANT,
    onHand: 10,
    committed: 2,
    available: 8,
    reorderPoint: 5,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function reservation(): ReservationView {
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
  };
}

function transfer(): TransferView {
  return {
    id: "t1",
    fromWarehouseId: WAREHOUSE,
    toWarehouseId: OTHER,
    variantId: VARIANT,
    quantity: 3,
    note: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function adjustment(): AdjustmentView {
  return {
    id: "a1",
    warehouseId: WAREHOUSE,
    variantId: VARIANT,
    quantityDelta: -3,
    reason: "damage",
    note: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function page<T>(rows: T[]): KeysetPage<T> {
  return { data: rows, page: { limit: 25, nextCursor: "c1", hasMore: true } };
}

/** A fully-mocked service: every public method replaced by a vitest mock fn. */
type ServiceMock = { [K in keyof InventoryService]: ReturnType<typeof vi.fn> };

function makeResponse(): Response & {
  status: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
} {
  return { status: vi.fn(), setHeader: vi.fn() } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
  };
}

function makeService(): ServiceMock {
  return {
    listWarehouses: vi.fn().mockResolvedValue(page([warehouse()])),
    getWarehouse: vi.fn().mockResolvedValue(warehouse()),
    createWarehouse: vi.fn().mockResolvedValue(warehouse()),
    updateWarehouse: vi.fn().mockResolvedValue(warehouse()),
    archiveWarehouse: vi.fn().mockResolvedValue(undefined),
    getWarehouseJoinCode: vi.fn().mockResolvedValue({ exists: false }),
    rotateWarehouseJoinCode: vi
      .fn()
      .mockResolvedValue({ code: "plain-code", createdAt: "2026-01-01T00:00:00.000Z" }),
    revokeWarehouseJoinCode: vi.fn().mockResolvedValue(undefined),
    listStock: vi.fn().mockResolvedValue(page([level()])),
    setReorderPoint: vi.fn().mockResolvedValue(level()),
    reserve: vi.fn().mockResolvedValue(reservation()),
    release: vi.fn().mockResolvedValue(reservation()),
    transfer: vi.fn().mockResolvedValue(transfer()),
    adjust: vi.fn().mockResolvedValue(adjustment()),
  } as unknown as ServiceMock;
}

describe("WarehousesController", () => {
  let service: ServiceMock;
  let controller: WarehousesController;

  beforeEach(() => {
    service = makeService();
    controller = new WarehousesController(service as unknown as InventoryService);
  });

  it("renders the keyset envelope", async () => {
    const result = await controller.list(principal, { sort: "name" });
    expect(service.listWarehouses).toHaveBeenCalledWith(principal, { sort: "name" });
    expect(result.data[0]).toMatchObject({ id: "w1", name: "Main", isDefault: true });
    expect(result.page).toEqual({ limit: 25, nextCursor: "c1", hasMore: true });
  });

  it("returns 201 with a Location header on create", async () => {
    const res = makeResponse();
    const dto = await controller.create(principal, { name: "Main" }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.setHeader).toHaveBeenCalledWith("Location", "/v1/warehouses/w1");
    expect(dto.id).toBe("w1");
  });

  it("delegates detail, update, and archive with the path id", async () => {
    await controller.getOne(principal, "w1");
    await controller.update(principal, "w1", { name: "Depot" });
    await controller.archive(principal, "w1");
    expect(service.getWarehouse).toHaveBeenCalledWith(principal, "w1");
    expect(service.updateWarehouse).toHaveBeenCalledWith(principal, "w1", { name: "Depot" });
    expect(service.archiveWarehouse).toHaveBeenCalledWith(principal, "w1");
  });

  it("delegates the join-code lifecycle (Vendor Accounts, Phase 1)", async () => {
    const status = await controller.getJoinCode(principal, "w1");
    expect(service.getWarehouseJoinCode).toHaveBeenCalledWith(principal, "w1");
    expect(status).toMatchObject({ exists: false });

    const created = await controller.rotateJoinCode(principal, "w1");
    expect(service.rotateWarehouseJoinCode).toHaveBeenCalledWith(principal, "w1");
    expect(created).toMatchObject({ code: "plain-code" });

    await controller.revokeJoinCode(principal, "w1");
    expect(service.revokeWarehouseJoinCode).toHaveBeenCalledWith(principal, "w1");
  });
});

describe("InventoryController", () => {
  let service: ServiceMock;
  let controller: InventoryController;

  beforeEach(() => {
    service = makeService();
    controller = new InventoryController(service as unknown as InventoryService);
  });

  it("renders stock levels including the derived available", async () => {
    const result = await controller.listStock(principal, { belowReorder: "true" });
    expect(service.listStock).toHaveBeenCalledWith(principal, { belowReorder: "true" });
    expect(result.data[0]).toMatchObject({
      onHand: 10,
      committed: 2,
      available: 8,
      reorderPoint: 5,
    });
  });

  it("passes an Idempotency-Key through to the service", async () => {
    const res = makeResponse();
    await controller.reserve(
      principal,
      { warehouseId: WAREHOUSE, variantId: VARIANT, quantity: 2 },
      "key-1",
      res,
    );
    expect(service.reserve).toHaveBeenCalledWith(principal, {
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      quantity: 2,
      idempotencyKey: "key-1",
    });
    expect(res.setHeader).toHaveBeenCalledWith("Location", "/v1/inventory/reservations/r1");
  });

  it("omits the key entirely when the header is absent", async () => {
    const res = makeResponse();
    await controller.reserve(
      principal,
      { warehouseId: WAREHOUSE, variantId: VARIANT, quantity: 2 },
      undefined,
      res,
    );
    expect(service.reserve).toHaveBeenCalledWith(principal, {
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      quantity: 2,
    });
  });

  it("releases a reservation by id", async () => {
    await controller.release(principal, "r1");
    expect(service.release).toHaveBeenCalledWith(principal, "r1");
  });

  it("renders a transfer as 201", async () => {
    const res = makeResponse();
    const dto = await controller.transfer(
      principal,
      {
        fromWarehouseId: WAREHOUSE,
        toWarehouseId: OTHER,
        variantId: VARIANT,
        quantity: 3,
      },
      undefined,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(dto).toMatchObject({ id: "t1", quantity: 3 });
  });

  it("renders an adjustment with its signed delta and reason", async () => {
    const res = makeResponse();
    const dto = await controller.adjust(
      principal,
      {
        warehouseId: WAREHOUSE,
        variantId: VARIANT,
        quantityDelta: -3,
        reason: "damage",
      },
      "key-2",
      res,
    );
    expect(service.adjust).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({ quantityDelta: -3, reason: "damage", idempotencyKey: "key-2" }),
    );
    expect(dto).toMatchObject({ quantityDelta: -3, reason: "damage" });
  });

  it("omits the key on a transfer and an adjustment when the header is absent", async () => {
    const res = makeResponse();
    await controller.transfer(
      principal,
      { fromWarehouseId: WAREHOUSE, toWarehouseId: OTHER, variantId: VARIANT, quantity: 3 },
      undefined,
      res,
    );
    await controller.adjust(
      principal,
      { warehouseId: WAREHOUSE, variantId: VARIANT, quantityDelta: -1, reason: "loss" },
      undefined,
      res,
    );
    expect(service.transfer.mock.calls[0]?.[1]).not.toHaveProperty("idempotencyKey");
    expect(service.adjust.mock.calls[0]?.[1]).not.toHaveProperty("idempotencyKey");
  });

  it("passes an Idempotency-Key through on a transfer", async () => {
    const res = makeResponse();
    await controller.transfer(
      principal,
      { fromWarehouseId: WAREHOUSE, toWarehouseId: OTHER, variantId: VARIANT, quantity: 3 },
      "key-3",
      res,
    );
    expect(service.transfer).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({ idempotencyKey: "key-3" }),
    );
  });

  it("sets a reorder point", async () => {
    const dto = await controller.setReorderPoint(principal, {
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      reorderPoint: 5,
    });
    expect(service.setReorderPoint).toHaveBeenCalled();
    expect(dto.reorderPoint).toBe(5);
  });
});
