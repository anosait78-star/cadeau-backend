import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { ResourceView } from "../domain/resource.types";
import type { MasterDataService } from "../application/master-data.service";
import { MasterDataController } from "./master-data.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

function emptyPage(): KeysetPage<ResourceView> {
  return { data: [], page: { limit: 25, nextCursor: null, hasMore: false } };
}

describe("MasterDataController", () => {
  let service: {
    list: ReturnType<typeof vi.fn>;
    getOne: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    deactivate: ReturnType<typeof vi.fn>;
  };
  let controller: MasterDataController;

  beforeEach(() => {
    service = {
      list: vi.fn().mockResolvedValue(emptyPage()),
      getOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deactivate: vi.fn().mockResolvedValue(undefined),
    };
    controller = new MasterDataController(service as unknown as MasterDataService);
  });

  it("lists the resources from the registry", () => {
    const list = controller.listResources();
    expect(list.data.map((r) => r.name)).toContain("order-labels");
    expect(list.data.find((r) => r.name === "currencies")?.editable).toBe(false);
  });

  it("splits reserved params from resource filters", async () => {
    await controller.list(principal, "order-reasons", {
      limit: "10",
      sort: "-createdAt",
      q: "x",
      active: "all",
      kind: "return",
    });
    expect(service.list).toHaveBeenCalledWith(principal, "order-reasons", {
      limit: "10",
      sort: "-createdAt",
      q: "x",
      active: "all",
      filters: { kind: "return" },
    });
  });

  it("create sets 201 + Location and returns the row", async () => {
    service.create.mockResolvedValue({ id: "new" } as ResourceView);
    const res = { status: vi.fn(), setHeader: vi.fn() } as unknown as Response;
    const row = await controller.create(principal, "order-labels", { name: "VIP" }, res);
    expect(row).toEqual({ id: "new" });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.setHeader).toHaveBeenCalledWith("Location", "/v1/master-data/order-labels/new");
  });

  it("delegates getOne, update, and delete", async () => {
    service.getOne.mockResolvedValue({ id: "x" } as ResourceView);
    await controller.getOne(principal, "order-labels", "x");
    expect(service.getOne).toHaveBeenCalledWith(principal, "order-labels", "x");

    service.update.mockResolvedValue({ id: "x" } as ResourceView);
    await controller.update(principal, "order-labels", "x", { name: "y" });
    expect(service.update).toHaveBeenCalledWith(principal, "order-labels", "x", { name: "y" });

    await controller.remove(principal, "order-labels", "x");
    expect(service.deactivate).toHaveBeenCalledWith(principal, "order-labels", "x");
  });
});
