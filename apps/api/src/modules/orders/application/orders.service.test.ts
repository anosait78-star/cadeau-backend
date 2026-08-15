import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeysetPage } from "@cadeau/database";
import type { AccessResolverService } from "../../../shared/access/access-resolver.service";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppException } from "../../../shared/errors/app-exception";
import type { OrderListView, OrderView, StatusChangeResult } from "../domain/order.entity";
import type { OrdersAuditPort } from "../domain/orders-audit.port";
import type { OrdersRepositoryPort } from "../domain/orders-repository.port";
import {
  DuplicateOrderError,
  IllegalTransitionError,
  InvalidListCursorError,
  PaymentStatusMismatchError,
  ReasonRequiredError,
} from "../domain/orders.errors";
import { OrdersService } from "./orders.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const ORDER = "33333333-3333-3333-3333-333333333333";
const CUSTOMER = "44444444-4444-4444-4444-444444444444";

function principal(overrides: Partial<RequestPrincipal> = {}): RequestPrincipal {
  return { userId: USER, sessionId: "s", companyId: COMPANY, ...overrides };
}

function order(extra: Partial<OrderView> = {}): OrderView {
  return {
    id: ORDER,
    orderNumber: 1042,
    customerId: CUSTOMER,
    customerName: "Sara",
    assigneeId: null,
    status: "new",
    followUpState: "none",
    labelId: null,
    reasonId: null,
    governorateId: null,
    warehouseId: null,
    itemCount: 1,
    subtotal: 30000,
    shippingFee: 5000,
    discount: 0,
    total: 35000,
    collectedAmount: 0,
    paymentStatus: "unpaid",
    statusChangedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    notes: null,
    items: [
      {
        id: "i1",
        variantId: "v1",
        warehouseId: null,
        nameSnapshot: "T — L",
        quantity: 2,
        price: 15000,
        costSnapshot: 8000,
      },
    ],
    ...extra,
  };
}

function emptyPage(): KeysetPage<OrderListView> {
  return { data: [], page: { limit: 25, nextCursor: null, hasMore: false } };
}

interface Harness {
  service: OrdersService;
  repo: { [K in keyof OrdersRepositoryPort]: ReturnType<typeof vi.fn> };
  audit: { record: ReturnType<typeof vi.fn> };
  events: { publish: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };
  access: { resolve: ReturnType<typeof vi.fn> };
}

function makeHarness(features: string[] = ["orders", "inventory"]): Harness {
  const change: StatusChangeResult = {
    order: order({ status: "processing" }),
    fromStatus: "new",
    toStatus: "processing",
    collectedDelta: 0,
  };
  const repo = {
    list: vi.fn().mockResolvedValue(emptyPage()),
    statusCounts: vi.fn().mockResolvedValue({}),
    findById: vi.fn().mockResolvedValue(order()),
    create: vi.fn().mockResolvedValue({ order: order(), replayed: false }),
    update: vi.fn().mockResolvedValue(order()),
    transition: vi.fn().mockResolvedValue(change),
    assign: vi.fn().mockResolvedValue(order({ assigneeId: USER })),
    bulkTransition: vi
      .fn()
      .mockResolvedValue({ results: [{ orderId: ORDER, ok: true }], changes: [change] }),
    bulkAssign: vi.fn().mockResolvedValue([{ orderId: ORDER, ok: true }]),
    listActivity: vi
      .fn()
      .mockResolvedValue({ data: [], page: { limit: 25, nextCursor: null, hasMore: false } }),
    listVendorGroups: vi.fn().mockResolvedValue([]),
    findVendorWarehouseId: vi.fn().mockResolvedValue(null),
    listVendorGroupsForWarehouse: vi.fn().mockResolvedValue([]),
    findVendorGroupById: vi.fn().mockResolvedValue(null),
    updateVendorGroupStatus: vi.fn().mockResolvedValue(null),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const events = { publish: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn() };
  // Default: unrestricted (Owner/Manager-equivalent) caller — sees every order,
  // not just ones assigned to them. Tests exercising the restricted-visibility
  // path override this with `access.resolve.mockResolvedValueOnce(...)`.
  const access = {
    resolve: vi.fn().mockResolvedValue({ features, permissions: ["orders.assign"] }),
  };
  const clock = { now: (): number => 1_700_000_000_000 };
  const service = new OrdersService(
    repo as unknown as OrdersRepositoryPort,
    audit as unknown as OrdersAuditPort,
    events,
    clock,
    access as unknown as AccessResolverService,
  );
  return { service, repo, audit, events, access };
}

describe("OrdersService", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("requires an active tenant", async () => {
    await expect(h.service.list(principal({ companyId: null }), {})).rejects.toBeInstanceOf(
      AppException,
    );
  });

  describe("create", () => {
    const body = { customerId: CUSTOMER, items: [{ variantId: "v1", quantity: 2, price: 15000 }] };

    it("audits and emits order.created on a fresh create", async () => {
      await h.service.create(principal(), body);
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "order.created", entityType: "order" }),
      );
      expect(h.events.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: "order.created" }),
      );
    });

    it("writes nothing on an idempotent replay", async () => {
      h.repo.create.mockResolvedValueOnce({ order: order(), replayed: true });
      await h.service.create(principal(), body);
      expect(h.audit.record).not.toHaveBeenCalled();
      expect(h.events.publish).not.toHaveBeenCalled();
    });

    it("maps a duplicate idempotency key to 409", async () => {
      h.repo.create.mockRejectedValueOnce(new DuplicateOrderError());
      await expect(h.service.create(principal(), body)).rejects.toMatchObject({ status: 409 });
    });

    it("maps a paymentStatus/collectedAmount mismatch to 422", async () => {
      h.repo.create.mockRejectedValueOnce(new PaymentStatusMismatchError());
      await expect(h.service.create(principal(), body)).rejects.toMatchObject({ status: 422 });
    });
  });

  describe("transition", () => {
    it("passes applyStock=true when the inventory feature is enabled", async () => {
      await h.service.transition(principal(), ORDER, { toStatus: "processing" });
      expect(h.repo.transition).toHaveBeenCalledWith(
        expect.anything(),
        ORDER,
        expect.objectContaining({ applyStock: true }),
      );
    });

    it("passes applyStock=false when inventory is off for the company", async () => {
      h = makeHarness(["orders"]);
      await h.service.transition(principal(), ORDER, { toStatus: "processing" });
      expect(h.repo.transition).toHaveBeenCalledWith(
        expect.anything(),
        ORDER,
        expect.objectContaining({ applyStock: false }),
      );
    });

    it("audits and emits order.status_changed", async () => {
      await h.service.transition(principal(), ORDER, { toStatus: "processing" });
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "order.status_changed" }),
      );
      expect(h.events.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "order.status_changed",
          payload: expect.objectContaining({ fromStatus: "new", toStatus: "processing" }),
        }),
      );
    });

    it("maps an illegal transition to 422", async () => {
      h.repo.transition.mockRejectedValueOnce(new IllegalTransitionError("new", "delivered"));
      await expect(
        h.service.transition(principal(), ORDER, { toStatus: "delivered" }),
      ).rejects.toMatchObject({ status: 422 });
    });

    it("maps a missing cancel reason to 422", async () => {
      h.repo.transition.mockRejectedValueOnce(new ReasonRequiredError());
      await expect(
        h.service.transition(principal(), ORDER, { toStatus: "cancelled" }),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  describe("update", () => {
    it("emits payment.collected when the collected amount rises", async () => {
      h.repo.findById.mockResolvedValueOnce(order({ collectedAmount: 0 }));
      h.repo.update.mockResolvedValueOnce(order({ collectedAmount: 35000, paymentStatus: "paid" }));
      await h.service.update(principal(), ORDER, { collectedAmount: 35000 });
      expect(h.events.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "payment.collected",
          payload: expect.objectContaining({ amountMinor: 35000 }),
        }),
      );
    });

    it("does not emit payment.collected when money did not change", async () => {
      h.repo.findById.mockResolvedValueOnce(order({ collectedAmount: 10000 }));
      h.repo.update.mockResolvedValueOnce(order({ collectedAmount: 10000 }));
      await h.service.update(principal(), ORDER, { notes: "hi" });
      const paymentEmit = h.events.publish.mock.calls.find(([e]) => e.type === "payment.collected");
      expect(paymentEmit).toBeUndefined();
    });

    it("throws 404 when the order to update is absent", async () => {
      h.repo.findById.mockResolvedValueOnce(null);
      await expect(h.service.update(principal(), ORDER, { notes: "x" })).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe("assign", () => {
    it("audits and emits order.assigned", async () => {
      await h.service.assign(principal(), ORDER, USER);
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "order.assigned" }),
      );
      expect(h.events.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "order.assigned",
          payload: { orderId: ORDER, assigneeId: USER },
        }),
      );
    });
  });

  describe("bulk", () => {
    it("emits one status_changed per successful item", async () => {
      const results = await h.service.bulkTransition(principal(), [ORDER], {
        toStatus: "processing",
      });
      expect(results).toEqual([{ orderId: ORDER, ok: true }]);
      expect(h.events.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: "order.status_changed" }),
      );
    });

    it("audits + emits order.assigned per successful bulk assign, skipping failures", async () => {
      h.repo.bulkAssign.mockResolvedValueOnce([
        { orderId: ORDER, ok: true },
        { orderId: "x", ok: false, error: { code: "NOT_FOUND", message: "no" } },
      ]);
      await h.service.bulkAssign(principal(), [ORDER, "x"], USER);
      const assignEmits = h.events.publish.mock.calls.filter(([e]) => e.type === "order.assigned");
      expect(assignEmits).toHaveLength(1);
    });
  });

  describe("smart-paste + import", () => {
    it("parses pasted text deterministically without touching the repo", () => {
      const draft = h.service.parse(principal(), "Name: Sara\n01001234567\n2 x Shirt");
      expect(draft.name).toBe("Sara");
      expect(draft.phone).toBe("+201001234567");
      expect(draft.items).toEqual([{ name: "Shirt", quantity: 2 }]);
      expect(h.repo.create).not.toHaveBeenCalled();
    });

    it("imports CSV rows, reporting a per-row result", async () => {
      h.repo.create.mockResolvedValue({ order: order(), replayed: false });
      const csv = "customer,variant,qty,price\n" + `${CUSTOMER},v1,2,15000\n,v2,1,1000`;
      const { results } = await h.service.importOrders(principal(), csv, {
        customerId: "customer",
        variantId: "variant",
        quantity: "qty",
        price: "price",
      });
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ row: 1, ok: true });
      expect(results[1]).toMatchObject({ row: 2, ok: false }); // missing customer
    });

    it("records a per-row failure when a create throws", async () => {
      h.repo.create.mockRejectedValueOnce(new IllegalTransitionError("new", "x"));
      const csv = "customer,variant,qty,price\n" + `${CUSTOMER},v1,2,15000`;
      const { results } = await h.service.importOrders(principal(), csv, {
        customerId: "customer",
        variantId: "variant",
        quantity: "qty",
        price: "price",
      });
      expect(results[0]).toMatchObject({ row: 1, ok: false });
    });
  });

  describe("reads", () => {
    it("getOne throws 404 when absent", async () => {
      h.repo.findById.mockResolvedValueOnce(null);
      await expect(h.service.getOne(principal(), ORDER)).rejects.toMatchObject({ status: 404 });
    });

    it("returns status counts", async () => {
      h.repo.statusCounts.mockResolvedValueOnce({ new: 2 });
      expect(await h.service.statusCounts(principal(), {})).toEqual({ new: 2 });
    });

    it("listActivity throws 404 when the order is absent", async () => {
      h.repo.listActivity.mockResolvedValueOnce(null);
      await expect(
        h.service.listActivity(principal(), ORDER, undefined, undefined),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("listVendorGroups throws 404 when the order is absent", async () => {
      h.repo.findById.mockResolvedValueOnce(null);
      await expect(h.service.listVendorGroups(principal(), ORDER)).rejects.toMatchObject({
        status: 404,
      });
      expect(h.repo.listVendorGroups).not.toHaveBeenCalled();
    });

    it("listVendorGroups delegates to the repository and audits/emits nothing (Vendor Accounts, Phase 2)", async () => {
      h.repo.findById.mockResolvedValueOnce(order());
      h.repo.listVendorGroups.mockResolvedValueOnce([
        {
          id: "g1",
          warehouseId: "w1",
          warehouseName: "Main",
          warehouseCode: null,
          vendorMemberId: null,
          vendorName: null,
          status: "new",
          items: [],
        },
      ]);
      const groups = await h.service.listVendorGroups(principal(), ORDER);
      expect(groups).toHaveLength(1);
      expect(h.repo.listVendorGroups).toHaveBeenCalledWith(
        { companyId: COMPANY, actorId: USER },
        ORDER,
      );
      expect(h.audit.record).not.toHaveBeenCalled();
      expect(h.events.publish).not.toHaveBeenCalled();
    });

    it("listMyVendorGroups returns an empty list for a caller with no vendor membership", async () => {
      h.repo.findVendorWarehouseId.mockResolvedValueOnce(null);
      const groups = await h.service.listMyVendorGroups(principal());
      expect(groups).toEqual([]);
      expect(h.repo.listVendorGroupsForWarehouse).not.toHaveBeenCalled();
    });

    it("listMyVendorGroups delegates to the repository for the caller's warehouse", async () => {
      h.repo.findVendorWarehouseId.mockResolvedValueOnce("w1");
      h.repo.listVendorGroupsForWarehouse.mockResolvedValueOnce([{ id: "g1" }]);
      const groups = await h.service.listMyVendorGroups(principal());
      expect(groups).toEqual([{ id: "g1" }]);
      expect(h.repo.listVendorGroupsForWarehouse).toHaveBeenCalledWith(COMPANY, "w1");
    });

    it("rejects an invalid list query with 400", async () => {
      await expect(h.service.list(principal(), { sort: "bogus" })).rejects.toMatchObject({
        status: 400,
      });
    });

    it("maps a bad cursor from the repository to 400", async () => {
      h.repo.list.mockRejectedValueOnce(new InvalidListCursorError());
      await expect(h.service.list(principal(), { cursor: "x" })).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe("visibility scoping (EPIC-15: orders.assign)", () => {
    const OTHER_USER = "55555555-5555-5555-5555-555555555555";

    it("list forces assigneeId to the caller when they lack orders.assign", async () => {
      h.access.resolve.mockResolvedValueOnce({ features: ["orders"], permissions: [] });
      await h.service.list(principal(), { assigneeId: OTHER_USER });
      expect(h.repo.list).toHaveBeenCalledWith(
        COMPANY,
        expect.objectContaining({
          assigneeId: USER,
        }),
      );
    });

    it("list leaves the query untouched when the caller holds orders.assign", async () => {
      await h.service.list(principal(), { assigneeId: OTHER_USER });
      expect(h.repo.list).toHaveBeenCalledWith(
        COMPANY,
        expect.objectContaining({
          assigneeId: OTHER_USER,
        }),
      );
    });

    it("getOne 404s when the caller lacks orders.assign and isn't the assignee", async () => {
      h.access.resolve.mockResolvedValueOnce({ features: ["orders"], permissions: [] });
      h.repo.findById.mockResolvedValueOnce(order({ assigneeId: OTHER_USER }));
      await expect(h.service.getOne(principal(), ORDER)).rejects.toMatchObject({ status: 404 });
    });

    it("listVendorGroups 404s when the caller lacks orders.assign and isn't the assignee (same rule as getOne)", async () => {
      h.access.resolve.mockResolvedValueOnce({ features: ["orders"], permissions: [] });
      h.repo.findById.mockResolvedValueOnce(order({ assigneeId: OTHER_USER }));
      await expect(h.service.listVendorGroups(principal(), ORDER)).rejects.toMatchObject({
        status: 404,
      });
      expect(h.repo.listVendorGroups).not.toHaveBeenCalled();
    });

    it("getOne succeeds for the assignee even without orders.assign", async () => {
      h.access.resolve.mockResolvedValueOnce({ features: ["orders"], permissions: [] });
      h.repo.findById.mockResolvedValueOnce(order({ assigneeId: USER }));
      await expect(h.service.getOne(principal(), ORDER)).resolves.toMatchObject({
        assigneeId: USER,
      });
    });

    it("transition 404s a member trying to act on an order not assigned to them", async () => {
      h.access.resolve.mockResolvedValueOnce({ features: ["orders"], permissions: [] });
      h.repo.findById.mockResolvedValueOnce(order({ assigneeId: OTHER_USER }));
      await expect(
        h.service.transition(principal(), ORDER, { toStatus: "processing" }),
      ).rejects.toMatchObject({ status: 404 });
      expect(h.repo.transition).not.toHaveBeenCalled();
    });

    it("bulkTransition drops ids the caller can't see into not-found results", async () => {
      // Two calls happen under the hood (feature-flag read + visibility check) —
      // persist the restricted grant across both.
      h.access.resolve.mockResolvedValue({ features: ["orders"], permissions: [] });
      h.repo.findById.mockResolvedValueOnce(order({ id: "other", assigneeId: OTHER_USER }));
      h.repo.bulkTransition.mockResolvedValueOnce({ results: [], changes: [] });
      const results = await h.service.bulkTransition(principal(), ["other"], {
        toStatus: "processing",
      });
      expect(results).toEqual([
        { orderId: "other", ok: false, error: { code: "NOT_FOUND", message: "Order not found." } },
      ]);
      expect(h.repo.bulkTransition).toHaveBeenCalledWith(expect.anything(), [], expect.anything());
    });
  });
});

describe("OrdersService — updateMyVendorGroupStatus (Vendor Accounts, Phase 3)", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("404s when the caller has no active vendor membership at all", async () => {
    h.repo.findVendorWarehouseId.mockResolvedValueOnce(null);
    await expect(
      h.service.updateMyVendorGroupStatus(principal(), "g1", "processing"),
    ).rejects.toMatchObject({ status: 404 });
    expect(h.repo.findVendorGroupById).not.toHaveBeenCalled();
  });

  it("404s when the group belongs to a different warehouse (never leaks existence)", async () => {
    h.repo.findVendorWarehouseId.mockResolvedValueOnce("w1");
    h.repo.findVendorGroupById.mockResolvedValueOnce({
      id: "g1",
      orderId: "o1",
      warehouseId: "w2",
      status: "new",
    });
    await expect(
      h.service.updateMyVendorGroupStatus(principal(), "g1", "processing"),
    ).rejects.toMatchObject({ status: 404 });
    expect(h.repo.updateVendorGroupStatus).not.toHaveBeenCalled();
  });

  it("404s when the group id does not exist in this tenant", async () => {
    h.repo.findVendorWarehouseId.mockResolvedValueOnce("w1");
    h.repo.findVendorGroupById.mockResolvedValueOnce(null);
    await expect(
      h.service.updateMyVendorGroupStatus(principal(), "g9", "processing"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("422s an invalid toStatus value", async () => {
    h.repo.findVendorWarehouseId.mockResolvedValueOnce("w1");
    h.repo.findVendorGroupById.mockResolvedValueOnce({
      id: "g1",
      orderId: "o1",
      warehouseId: "w1",
      status: "new",
    });
    await expect(
      h.service.updateMyVendorGroupStatus(principal(), "g1", "not-a-status"),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("422s a skipped/illegal jump", async () => {
    h.repo.findVendorWarehouseId.mockResolvedValueOnce("w1");
    h.repo.findVendorGroupById.mockResolvedValueOnce({
      id: "g1",
      orderId: "o1",
      warehouseId: "w1",
      status: "new",
    });
    await expect(
      h.service.updateMyVendorGroupStatus(principal(), "g1", "delivered"),
    ).rejects.toMatchObject({ status: 422 });
    expect(h.repo.updateVendorGroupStatus).not.toHaveBeenCalled();
  });

  it("422s moving backward", async () => {
    h.repo.findVendorWarehouseId.mockResolvedValueOnce("w1");
    h.repo.findVendorGroupById.mockResolvedValueOnce({
      id: "g1",
      orderId: "o1",
      warehouseId: "w1",
      status: "processing",
    });
    await expect(
      h.service.updateMyVendorGroupStatus(principal(), "g1", "new"),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("409s when the group already moved past the expected status (concurrent change)", async () => {
    h.repo.findVendorWarehouseId.mockResolvedValueOnce("w1");
    h.repo.findVendorGroupById.mockResolvedValueOnce({
      id: "g1",
      orderId: "o1",
      warehouseId: "w1",
      status: "new",
    });
    h.repo.updateVendorGroupStatus.mockResolvedValueOnce(null);
    await expect(
      h.service.updateMyVendorGroupStatus(principal(), "g1", "processing"),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("advances the status, records an audit row, and publishes the event", async () => {
    h.repo.findVendorWarehouseId.mockResolvedValueOnce("w1");
    h.repo.findVendorGroupById.mockResolvedValueOnce({
      id: "g1",
      orderId: "o1",
      warehouseId: "w1",
      status: "new",
    });
    h.repo.updateVendorGroupStatus.mockResolvedValueOnce({
      id: "g1",
      orderId: "o1",
      orderNumber: 1042,
      warehouseId: "w1",
      warehouseName: "Main",
      warehouseCode: null,
      vendorMemberId: null,
      vendorName: null,
      status: "processing",
      items: [],
    });

    const updated = await h.service.updateMyVendorGroupStatus(principal(), "g1", "processing");

    expect(updated.status).toBe("processing");
    expect(h.repo.updateVendorGroupStatus).toHaveBeenCalledWith(
      { companyId: COMPANY, actorId: USER },
      "g1",
      "new",
      "processing",
    );
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "order_vendor_group.status_changed",
        entityType: "order_vendor_group",
        entityId: "g1",
        changes: { orderId: "o1", warehouseId: "w1", from: "new", to: "processing" },
      }),
    );
    expect(h.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "order_vendor_group.status_changed",
        payload: {
          orderId: "o1",
          orderVendorGroupId: "g1",
          warehouseId: "w1",
          fromStatus: "new",
          toStatus: "processing",
        },
      }),
    );
  });
});
