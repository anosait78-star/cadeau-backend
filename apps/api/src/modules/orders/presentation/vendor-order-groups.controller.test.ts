import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { OrderVendorGroupView } from "../domain/order.entity";
import type { OrdersService } from "../application/orders.service";
import { VendorOrderGroupsController } from "./vendor-order-groups.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

function group(extra: Partial<OrderVendorGroupView> = {}): OrderVendorGroupView {
  return {
    id: "g1",
    orderId: "o1",
    orderNumber: 1042,
    warehouseId: "w1",
    warehouseName: "Main",
    warehouseCode: null,
    vendorMemberId: null,
    vendorName: null,
    status: "new",
    updatedAt: "2026-01-01T00:00:00.000Z",
    items: [],
    ...extra,
  };
}

interface Harness {
  controller: VendorOrderGroupsController;
  service: { [K in keyof OrdersService]: ReturnType<typeof vi.fn> };
}

function makeHarness(): Harness {
  const service = {
    listMyVendorGroups: vi.fn().mockResolvedValue([group()]),
    updateMyVendorGroupStatus: vi.fn().mockResolvedValue(group({ status: "processing" })),
  } as unknown as Harness["service"];
  const controller = new VendorOrderGroupsController(service as unknown as OrdersService);
  return { controller, service };
}

describe("VendorOrderGroupsController (Vendor Accounts, Phase 3)", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("lists my vendor groups", async () => {
    const res = await h.controller.list(principal);
    expect(h.service.listMyVendorGroups).toHaveBeenCalledWith(principal);
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({ id: "g1", warehouseId: "w1" });
  });

  it("advances a group's status", async () => {
    const res = await h.controller.updateStatus(principal, "g1", { toStatus: "processing" });
    expect(h.service.updateMyVendorGroupStatus).toHaveBeenCalledWith(principal, "g1", "processing");
    expect(res.status).toBe("processing");
  });
});
