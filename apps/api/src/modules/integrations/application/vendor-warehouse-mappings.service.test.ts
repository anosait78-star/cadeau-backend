import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { StorefrontAuditPort } from "../domain/storefront-audit.port";
import type { StorefrontConnectionsRepositoryPort } from "../domain/storefront-connections-repository.port";
import { DuplicateVendorMappingError, WarehouseNotFoundError } from "../domain/storefront.errors";
import type { VendorWarehouseMappingsRepositoryPort } from "../domain/vendor-warehouse-mappings-repository.port";
import { VendorWarehouseMappingsService } from "./vendor-warehouse-mappings.service";

const COMPANY = "co-1";
const CONNECTION_ID = "conn-1";

function principal(overrides: Partial<RequestPrincipal> = {}): RequestPrincipal {
  return { userId: "user-1", sessionId: "s", companyId: COMPANY, ...overrides };
}

function makeHarness() {
  const repo = {
    findWarehouseId: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  };
  const connections = {
    list: vi.fn(),
    findById: vi.fn().mockResolvedValue({ id: CONNECTION_ID }),
    create: vi.fn(),
    update: vi.fn(),
    rotateKey: vi.fn(),
    revoke: vi.fn(),
    findActiveByKeyPrefix: vi.fn(),
    touchLastEventAt: vi.fn(),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new VendorWarehouseMappingsService(
    repo as unknown as VendorWarehouseMappingsRepositoryPort,
    connections as unknown as StorefrontConnectionsRepositoryPort,
    audit as unknown as StorefrontAuditPort,
  );
  return { service, repo, connections, audit };
}

describe("VendorWarehouseMappingsService.create", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  it("creates a mapping and audits it without leaking the connection's other data", async () => {
    h.repo.create.mockResolvedValue({
      id: "map-1",
      connectionId: CONNECTION_ID,
      externalVendorId: "1527",
      warehouseId: "wh-A",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await h.service.create(principal(), CONNECTION_ID, {
      externalVendorId: "1527",
      warehouseId: "wh-A",
    });

    expect(result.warehouseId).toBe("wh-A");
    expect(h.repo.create).toHaveBeenCalledWith(
      { companyId: COMPANY, actorId: "user-1" },
      { connectionId: CONNECTION_ID, externalVendorId: "1527", warehouseId: "wh-A" },
    );
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "storefront_vendor_warehouse_mapping.created" }),
    );
  });

  it("404s when the connection does not belong to the caller's company", async () => {
    h.connections.findById.mockResolvedValue(null);
    await expect(
      h.service.create(principal(), CONNECTION_ID, {
        externalVendorId: "1527",
        warehouseId: "wh-A",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(h.repo.create).not.toHaveBeenCalled();
  });

  it("maps a duplicate (connection, vendor) mapping to 409", async () => {
    h.repo.create.mockRejectedValue(new DuplicateVendorMappingError());
    await expect(
      h.service.create(principal(), CONNECTION_ID, {
        externalVendorId: "1527",
        warehouseId: "wh-A",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("maps an unknown warehouse to 422", async () => {
    h.repo.create.mockRejectedValue(new WarehouseNotFoundError());
    await expect(
      h.service.create(principal(), CONNECTION_ID, {
        externalVendorId: "1527",
        warehouseId: "bad",
      }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe("VendorWarehouseMappingsService.delete", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  it("deletes an existing mapping and audits it", async () => {
    h.repo.delete.mockResolvedValue(true);
    await h.service.delete(principal(), CONNECTION_ID, "map-1");
    expect(h.repo.delete).toHaveBeenCalledWith(COMPANY, CONNECTION_ID, "map-1");
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "storefront_vendor_warehouse_mapping.deleted" }),
    );
  });

  it("404s when the mapping does not exist", async () => {
    h.repo.delete.mockResolvedValue(false);
    await expect(h.service.delete(principal(), CONNECTION_ID, "missing")).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("VendorWarehouseMappingsService.list", () => {
  it("requires an active company", async () => {
    const h = makeHarness();
    await expect(
      h.service.list(principal({ companyId: null }), CONNECTION_ID, undefined, undefined),
    ).rejects.toMatchObject({ status: 403 });
  });
});
