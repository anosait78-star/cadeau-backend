import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppException } from "../../../shared/errors/app-exception";
import type { EventBusPort } from "../../../shared/events/event-bus.port";
import type { Clock } from "../../../shared/time/clock";
import type { MasterDataAuditPort } from "../domain/master-data-audit.port";
import type { MasterDataRepositoryPort } from "../domain/master-data-repository.port";
import { DuplicateResourceError, ReferenceNotFoundError } from "../domain/master-data.errors";
import type { ResourceView } from "../domain/resource.types";
import { MasterDataCache } from "./master-data-cache";
import { MasterDataService } from "./master-data.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

function principal(overrides: Partial<RequestPrincipal> = {}): RequestPrincipal {
  return { userId: USER, sessionId: "s", companyId: COMPANY, ...overrides };
}

function view(id: string, extra: Record<string, unknown> = {}): ResourceView {
  return {
    id,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function emptyPage(): KeysetPage<ResourceView> {
  return { data: [], page: { limit: 25, nextCursor: null, hasMore: false } };
}

interface Harness {
  service: MasterDataService;
  repo: {
    list: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    listActive: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    deactivate: ReturnType<typeof vi.fn>;
  };
  audit: { record: ReturnType<typeof vi.fn> };
  events: { publish: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };
  cache: MasterDataCache;
}

function makeHarness(): Harness {
  const repo = {
    list: vi.fn().mockResolvedValue(emptyPage()),
    findById: vi.fn(),
    listActive: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    deactivate: vi.fn(),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const events = { publish: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn() };
  const clock: Clock = { now: () => 1_700_000_000_000 };
  const cache = new MasterDataCache(clock);
  const service = new MasterDataService(
    repo as unknown as MasterDataRepositoryPort,
    audit as unknown as MasterDataAuditPort,
    events as unknown as EventBusPort,
    clock,
    cache,
  );
  return { service, repo, audit, events, cache };
}

describe("MasterDataService reads", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("lists a system resource with a null companyId", async () => {
    await h.service.list(principal(), "currencies", { filters: {} });
    expect(h.repo.list).toHaveBeenCalledWith(
      expect.objectContaining({ name: "currencies" }),
      null,
      expect.anything(),
    );
  });

  it("lists a tenant resource scoped to the company", async () => {
    await h.service.list(principal(), "order-labels", { filters: {} });
    expect(h.repo.list).toHaveBeenCalledWith(
      expect.objectContaining({ name: "order-labels" }),
      COMPANY,
      expect.anything(),
    );
  });

  it("rejects an unknown resource with 404", async () => {
    await expect(h.service.list(principal(), "nope", { filters: {} })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("rejects an invalid list query with 400 VALIDATION_FAILED", async () => {
    await expect(
      h.service.list(principal(), "order-labels", { sort: "bogus", filters: {} }),
    ).rejects.toBeInstanceOf(AppException);
    expect(h.repo.list).not.toHaveBeenCalled();
  });

  it("requires an active company for a tenant read", async () => {
    await expect(
      h.service.list(principal({ companyId: null }), "order-labels", { filters: {} }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("maps a repo InvalidListCursorError to 400", async () => {
    const { InvalidListCursorError } = await import("../domain/master-data.errors");
    h.repo.list.mockRejectedValueOnce(new InvalidListCursorError());
    await expect(
      h.service.list(principal(), "order-labels", { cursor: "bad", filters: {} }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rethrows an unexpected repo error unchanged", async () => {
    const boom = new Error("boom");
    h.repo.list.mockRejectedValueOnce(boom);
    await expect(h.service.list(principal(), "order-labels", { filters: {} })).rejects.toBe(boom);
  });

  it("caches system reference under the 'system' scope", async () => {
    h.repo.listActive.mockResolvedValue([view("EGP")]);
    await h.service.listActiveCached(principal(), "currencies");
    expect(h.cache.get("currencies", "system")).toEqual([view("EGP")]);
  });

  it("getOne returns the row or 404", async () => {
    h.repo.findById.mockResolvedValueOnce(view("x"));
    expect(await h.service.getOne(principal(), "order-labels", "x")).toEqual(view("x"));
    h.repo.findById.mockResolvedValueOnce(null);
    await expect(h.service.getOne(principal(), "order-labels", "y")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("listActiveCached caches after the first load", async () => {
    h.repo.listActive.mockResolvedValue([view("a")]);
    const first = await h.service.listActiveCached(principal(), "order-labels");
    const second = await h.service.listActiveCached(principal(), "order-labels");
    expect(first).toEqual([view("a")]);
    expect(second).toEqual([view("a")]);
    expect(h.repo.listActive).toHaveBeenCalledTimes(1);
  });
});

describe("MasterDataService writes", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("rejects writes to a system resource with 403", async () => {
    await expect(
      h.service.create(principal(), "currencies", { code: "EGP", name: "x", symbol: "y" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(h.repo.create).not.toHaveBeenCalled();
  });

  it("creates, audits, invalidates the cache, and emits master_data.changed", async () => {
    h.repo.create.mockResolvedValue(view("new", { name: "VIP" }));
    h.cache.set("order-labels", COMPANY, [view("old")]);

    const created = await h.service.create(principal(), "order-labels", { name: "VIP" });

    expect(created.id).toBe("new");
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "master_data.created",
        entityType: "order-labels",
        entityId: "new",
        companyId: COMPANY,
        actorId: USER,
      }),
    );
    expect(h.cache.get("order-labels", COMPANY)).toBeNull();
    expect(h.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "master_data.changed",
        companyId: COMPANY,
        actorId: USER,
        payload: { resource: "order-labels", id: "new", change: "created" },
      }),
    );
  });

  it("audit precedes the event emission", async () => {
    const order: string[] = [];
    h.repo.create.mockResolvedValue(view("new"));
    h.audit.record.mockImplementation(() => {
      order.push("audit");
      return Promise.resolve();
    });
    h.events.publish.mockImplementation(() => {
      order.push("event");
      return Promise.resolve();
    });
    await h.service.create(principal(), "order-labels", { name: "VIP" });
    expect(order).toEqual(["audit", "event"]);
  });

  it("maps a duplicate to 409 CONFLICT and skips audit", async () => {
    h.repo.create.mockRejectedValue(new DuplicateResourceError());
    await expect(
      h.service.create(principal(), "order-labels", { name: "VIP" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.audit.record).not.toHaveBeenCalled();
  });

  it("maps a bad reference to 422", async () => {
    h.repo.create.mockRejectedValue(new ReferenceNotFoundError("parentId"));
    await expect(
      h.service.create(principal(), "product-categories", { name: "Shoes" }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rejects an invalid create body before touching the repo", async () => {
    await expect(h.service.create(principal(), "order-labels", {})).rejects.toBeInstanceOf(
      AppException,
    );
    expect(h.repo.create).not.toHaveBeenCalled();
  });

  it("update returns 404 when the row is absent", async () => {
    h.repo.update.mockResolvedValue(null);
    await expect(
      h.service.update(principal(), "order-labels", "x", { name: "y" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(h.audit.record).not.toHaveBeenCalled();
  });

  it("update emits the updated change", async () => {
    h.repo.update.mockResolvedValue(view("x", { name: "y" }));
    await h.service.update(principal(), "order-labels", "x", { name: "y" });
    expect(h.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { resource: "order-labels", id: "x", change: "updated" },
      }),
    );
  });

  it("deactivate soft-deletes and emits, or 404", async () => {
    h.repo.deactivate.mockResolvedValueOnce(view("x", { active: false }));
    await h.service.deactivate(principal(), "order-labels", "x");
    expect(h.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { resource: "order-labels", id: "x", change: "deactivated" },
      }),
    );

    h.repo.deactivate.mockResolvedValueOnce(null);
    await expect(h.service.deactivate(principal(), "order-labels", "z")).rejects.toMatchObject({
      status: 404,
    });
  });
});
