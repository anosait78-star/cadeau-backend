import { describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { ProductsService } from "../application/products.service";
import type { VendorProductView } from "../domain/product.entity";
import { VendorProductsController } from "./vendor-products.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

function product(extra: Partial<VendorProductView> = {}): VendorProductView {
  return {
    id: "p1",
    name: "Classic Mug",
    imageUrl: null,
    priceMinor: 15000,
    availableQuantity: 12,
    ...extra,
  };
}

function makeController(): {
  controller: VendorProductsController;
  service: { listMyVendorProducts: ReturnType<typeof vi.fn> };
} {
  const service = { listMyVendorProducts: vi.fn().mockResolvedValue([product()]) };
  const controller = new VendorProductsController(service as unknown as ProductsService);
  return { controller, service };
}

describe("VendorProductsController (Vendor Accounts)", () => {
  it("lists my warehouse's products", async () => {
    const { controller, service } = makeController();
    const res = await controller.list(principal);
    expect(service.listMyVendorProducts).toHaveBeenCalledWith(principal);
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({ id: "p1", availableQuantity: 12, priceMinor: 15000 });
  });

  it("returns an empty list when the vendor has no warehouse membership", async () => {
    const { controller, service } = makeController();
    service.listMyVendorProducts.mockResolvedValue([]);
    const res = await controller.list(principal);
    expect(res.data).toEqual([]);
  });
});
