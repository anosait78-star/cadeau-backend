import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Clock } from "../../../shared/time/clock";
import type { EventBusPort } from "../../../shared/events/event-bus.port";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { ProductsAuditPort } from "../domain/products-audit.port";
import type { ProductsRepositoryPort } from "../domain/products-repository.port";
import { ProductsService } from "./products.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const WAREHOUSE = "22222222-2222-2222-2222-222222222222";

const principal: RequestPrincipal = {
  userId: "33333333-3333-3333-3333-333333333333",
  sessionId: "s",
  companyId: COMPANY,
};

const emptyPage = { data: [], page: { limit: 25, nextCursor: null, hasMore: false } };

function makeService() {
  const repo = {
    list: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    listVariants: vi.fn(),
    createVariant: vi.fn(),
    updateVariant: vi.fn(),
    findVariantBySku: vi.fn(),
    findVendorWarehouseId: vi.fn(),
    listForWarehouse: vi.fn(),
    searchSellableVariants: vi.fn().mockResolvedValue(emptyPage),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const events = { publish: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn() };
  const clock: Clock = { now: () => 1_700_000_000_000 };
  const service = new ProductsService(
    repo as unknown as ProductsRepositoryPort,
    audit as unknown as ProductsAuditPort,
    events as unknown as EventBusPort,
    clock,
  );
  return { service, repo };
}

describe("ProductsService.searchSellableVariants", () => {
  let h: ReturnType<typeof makeService>;
  beforeEach(() => {
    h = makeService();
  });

  it("scopes the search to the caller's company", async () => {
    await h.service.searchSellableVariants(principal, { q: "قميص" });
    expect(h.repo.searchSellableVariants).toHaveBeenCalledWith(
      COMPANY,
      expect.objectContaining({ q: "قميص" }),
    );
  });

  it("requires an active company", async () => {
    await expect(
      h.service.searchSellableVariants({ ...principal, companyId: null }, {}),
    ).rejects.toMatchObject({ status: 403 });
    expect(h.repo.searchSellableVariants).not.toHaveBeenCalled();
  });

  it("passes the warehouse and stock filters through", async () => {
    await h.service.searchSellableVariants(principal, {
      warehouseId: WAREHOUSE,
      hasStock: "true",
    });
    expect(h.repo.searchSellableVariants).toHaveBeenCalledWith(
      COMPANY,
      expect.objectContaining({ warehouseId: WAREHOUSE, hasStock: true }),
    );
  });

  // The warehouse id reaches a query filter, so a bad one is refused before it
  // gets anywhere near the repository.
  it("rejects a malformed warehouseId without querying", async () => {
    await expect(
      h.service.searchSellableVariants(principal, { warehouseId: "not-a-uuid" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(h.repo.searchSellableVariants).not.toHaveBeenCalled();
  });

  it("treats an untouched search box as no search", async () => {
    await h.service.searchSellableVariants(principal, { q: "   " });
    const [, query] = h.repo.searchSellableVariants.mock.calls[0] ?? [];
    expect((query as { q?: string }).q).toBeUndefined();
  });
});
