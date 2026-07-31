import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppException } from "../../../shared/errors/app-exception";
import type {
  CustomerAddressView,
  CustomerListView,
  CustomerView,
} from "../domain/customer.entity";
import type { CustomersAuditPort } from "../domain/customers-audit.port";
import type { CustomersRepositoryPort } from "../domain/customers-repository.port";
import {
  DuplicateCustomerError,
  InvalidListCursorError,
  ReferenceNotFoundError,
} from "../domain/customers.errors";
import { CustomersService } from "./customers.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const CUSTOMER = "33333333-3333-3333-3333-333333333333";

function principal(overrides: Partial<RequestPrincipal> = {}): RequestPrincipal {
  return { userId: USER, sessionId: "s", companyId: COMPANY, ...overrides };
}

function customer(extra: Partial<CustomerView> = {}): CustomerView {
  return {
    id: CUSTOMER,
    name: "Ahmed",
    phone: "+201001234567",
    email: null,
    notes: null,
    ordersCount: 0,
    totalSpent: 0,
    lastOrderAt: null,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function address(extra: Partial<CustomerAddressView> = {}): CustomerAddressView {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    customerId: CUSTOMER,
    line: "12 Nile St",
    landmark: null,
    notes: null,
    governorateId: null,
    isDefault: false,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function emptyPage(): KeysetPage<CustomerListView> {
  return { data: [], page: { limit: 25, nextCursor: null, hasMore: false } };
}

interface Harness {
  service: CustomersService;
  repo: { [K in keyof CustomersRepositoryPort]: ReturnType<typeof vi.fn> };
  audit: { [K in keyof CustomersAuditPort]: ReturnType<typeof vi.fn> };
  events: { publish: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };
}

function makeHarness(): Harness {
  const repo = {
    list: vi.fn().mockResolvedValue(emptyPage()),
    findById: vi.fn(),
    create: vi.fn().mockResolvedValue({ customer: customer(), replayed: false }),
    update: vi.fn().mockResolvedValue(customer()),
    archive: vi.fn().mockResolvedValue(customer({ active: false })),
    exportAll: vi.fn().mockResolvedValue([customer()]),
    listAddresses: vi.fn(),
    createAddress: vi.fn().mockResolvedValue(address()),
    updateAddress: vi.fn().mockResolvedValue(address()),
    listCustomerOrders: vi
      .fn()
      .mockResolvedValue({ data: [], page: { limit: 25, nextCursor: null, hasMore: false } }),
    merge: vi.fn().mockResolvedValue({ survivingCustomerId: CUSTOMER, mergedCustomerId: "m1" }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const events = { publish: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn() };
  const clock = { now: (): number => 1_700_000_000_000 };
  const service = new CustomersService(
    repo as unknown as CustomersRepositoryPort,
    audit as unknown as CustomersAuditPort,
    events,
    clock,
  );
  return { service, repo, audit, events };
}

let h: Harness;
beforeEach(() => {
  h = makeHarness();
});

describe("CustomersService — tenant enforcement", () => {
  it("refuses every operation without an active company", async () => {
    const noTenant = principal({ companyId: null });
    await expect(h.service.list(noTenant, {})).rejects.toBeInstanceOf(AppException);
    await expect(h.service.getOne(noTenant, CUSTOMER)).rejects.toBeInstanceOf(AppException);
    await expect(
      h.service.create(noTenant, { name: "A", phone: "+201001234567" }),
    ).rejects.toBeInstanceOf(AppException);
    await expect(h.service.archive(noTenant, CUSTOMER)).rejects.toBeInstanceOf(AppException);
    await expect(h.service.export(noTenant, {})).rejects.toBeInstanceOf(AppException);
    expect(h.repo.create).not.toHaveBeenCalled();
    expect(h.repo.exportAll).not.toHaveBeenCalled();
  });
});

describe("CustomersService — export", () => {
  it("audits and emits before returning the rows", async () => {
    const rows = await h.service.export(principal(), { active: "all" });

    expect(rows).toHaveLength(1);
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "customer.exported",
        entityType: "customer",
        entityId: COMPANY,
        changes: { count: 1 },
      }),
    );
    expect(h.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "customer.exported", payload: { count: 1 } }),
    );
  });

  it("neither audits nor exports when the filters are invalid", async () => {
    await expect(h.service.export(principal(), { sort: "phone" })).rejects.toMatchObject({
      status: 400,
    });
    expect(h.repo.exportAll).not.toHaveBeenCalled();
    expect(h.audit.record).not.toHaveBeenCalled();
  });

  it("passes the parsed filters through to the repository", async () => {
    await h.service.export(principal(), { q: "+20 100 123 4567" });
    expect(h.repo.exportAll).toHaveBeenCalledWith(
      COMPANY,
      expect.objectContaining({ search: { kind: "phone", e164: "+201001234567" } }),
    );
  });
});

describe("CustomersService — phone normalization", () => {
  it("normalizes before the repository ever sees the value", async () => {
    await h.service.create(principal(), { name: "Ahmed", phone: "+20 100 123 4567" });
    expect(h.repo.create).toHaveBeenCalledWith(
      { companyId: COMPANY, actorId: USER },
      expect.objectContaining({ phone: "+201001234567" }),
    );
  });

  it("rejects an un-normalizable phone with 422 and never calls the repository", async () => {
    await expect(
      h.service.create(principal(), { name: "Ahmed", phone: "01001234567" }),
    ).rejects.toMatchObject({ status: 422 });
    expect(h.repo.create).not.toHaveBeenCalled();
  });

  it("normalizes on update too", async () => {
    await h.service.update(principal(), CUSTOMER, { phone: "00201001234567" });
    expect(h.repo.update).toHaveBeenCalledWith(
      { companyId: COMPANY, actorId: USER },
      CUSTOMER,
      expect.objectContaining({ phone: "+201001234567" }),
    );
  });
});

describe("CustomersService — create", () => {
  it("audits then emits on a real create", async () => {
    await h.service.create(principal(), { name: "Ahmed", phone: "+201001234567" });
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "customer.created", entityId: CUSTOMER }),
    );
    expect(h.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "customer.created", payload: { customerId: CUSTOMER } }),
    );
  });

  it("writes NOTHING on an idempotent replay", async () => {
    h.repo.create.mockResolvedValue({ customer: customer(), replayed: true });
    const result = await h.service.create(principal(), {
      name: "Ahmed",
      phone: "+201001234567",
      idempotencyKey: "k1",
    });
    expect(result.replayed).toBe(true);
    expect(h.audit.record).not.toHaveBeenCalled();
    expect(h.events.publish).not.toHaveBeenCalled();
  });

  it("passes the idempotency key through", async () => {
    await h.service.create(principal(), {
      name: "Ahmed",
      phone: "+201001234567",
      idempotencyKey: "k1",
    });
    expect(h.repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ idempotencyKey: "k1" }),
    );
  });
});

describe("CustomersService — PII never leaves in audit rows or events", () => {
  it("records no personal value on create", async () => {
    await h.service.create(principal(), {
      name: "Ahmed",
      phone: "+201001234567",
      email: "a@example.com",
    });
    const serialized = JSON.stringify([h.audit.record.mock.calls, h.events.publish.mock.calls]);
    expect(serialized).not.toContain("+201001234567");
    expect(serialized).not.toContain("Ahmed");
    expect(serialized).not.toContain("a@example.com");
  });

  it("records field NAMES on update, never their values", async () => {
    await h.service.update(principal(), CUSTOMER, {
      phone: "+201009999999",
      name: "New Name",
    });
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "customer.updated",
        changes: { fields: ["name", "phone"] },
      }),
    );
    const serialized = JSON.stringify([h.audit.record.mock.calls, h.events.publish.mock.calls]);
    expect(serialized).not.toContain("+201009999999");
    expect(serialized).not.toContain("New Name");
  });

  it("emits only the id and the changed field names", async () => {
    await h.service.update(principal(), CUSTOMER, { email: "b@example.com" });
    expect(h.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "customer.updated",
        payload: { customerId: CUSTOMER, fields: ["email"] },
      }),
    );
  });

  it("records no personal value when an address is written", async () => {
    await h.service.createAddress(principal(), CUSTOMER, { line: "12 Nile St" });
    const serialized = JSON.stringify([h.audit.record.mock.calls, h.events.publish.mock.calls]);
    expect(serialized).not.toContain("12 Nile St");
  });
});

describe("CustomersService — not found", () => {
  it("maps a missing customer to 404 on read, update, archive", async () => {
    h.repo.findById.mockResolvedValue(null);
    h.repo.update.mockResolvedValue(null);
    h.repo.archive.mockResolvedValue(null);
    await expect(h.service.getOne(principal(), CUSTOMER)).rejects.toMatchObject({ status: 404 });
    await expect(h.service.update(principal(), CUSTOMER, { name: "x" })).rejects.toMatchObject({
      status: 404,
    });
    await expect(h.service.archive(principal(), CUSTOMER)).rejects.toMatchObject({ status: 404 });
  });

  it("does not audit or emit when the row was not found", async () => {
    h.repo.archive.mockResolvedValue(null);
    await expect(h.service.archive(principal(), CUSTOMER)).rejects.toBeInstanceOf(AppException);
    expect(h.audit.record).not.toHaveBeenCalled();
    expect(h.events.publish).not.toHaveBeenCalled();
  });

  it("maps a missing customer to 404 when adding an address", async () => {
    h.repo.createAddress.mockResolvedValue(null);
    await expect(
      h.service.createAddress(principal(), CUSTOMER, { line: "x" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("CustomersService — error mapping", () => {
  it("maps a duplicate phone to 409 naming the field", async () => {
    h.repo.create.mockRejectedValue(new DuplicateCustomerError("phone"));
    await expect(
      h.service.create(principal(), { name: "A", phone: "+201001234567" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("maps a missing governorate to 422", async () => {
    h.repo.createAddress.mockRejectedValue(new ReferenceNotFoundError("governorateId"));
    await expect(
      h.service.createAddress(principal(), CUSTOMER, { line: "x", governorateId: "g" }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("maps a tampered cursor to 400", async () => {
    h.repo.list.mockRejectedValue(new InvalidListCursorError());
    await expect(h.service.list(principal(), { cursor: "bad" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("rejects an invalid list query with 400 before touching the repository", async () => {
    await expect(h.service.list(principal(), { sort: "nope" })).rejects.toMatchObject({
      status: 400,
    });
    expect(h.repo.list).not.toHaveBeenCalled();
  });
});

describe("CustomersService — archive", () => {
  it("audits the archive and emits an update carrying only the active field name", async () => {
    await h.service.archive(principal(), CUSTOMER);
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "customer.archived" }),
    );
    expect(h.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "customer.updated",
        payload: { customerId: CUSTOMER, fields: ["active"] },
      }),
    );
  });
});

describe("CustomersService — addresses", () => {
  it("returns the addresses of an existing customer", async () => {
    h.repo.listAddresses.mockResolvedValue([address()]);
    await expect(h.service.listAddresses(principal(), CUSTOMER)).resolves.toHaveLength(1);
  });

  it("maps a missing customer to 404 when listing addresses", async () => {
    h.repo.listAddresses.mockResolvedValue(null);
    await expect(h.service.listAddresses(principal(), CUSTOMER)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("maps a missing address to 404 on update", async () => {
    h.repo.updateAddress.mockResolvedValue(null);
    await expect(
      h.service.updateAddress(principal(), CUSTOMER, "a1", { line: "x" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("CustomersService — merge & order history (EPIC-11)", () => {
  it("audits and emits customer.merged", async () => {
    await h.service.merge(principal(), CUSTOMER, "m1");
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "customer.merged", entityId: CUSTOMER }),
    );
    expect(h.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "customer.merged",
        payload: { survivingCustomerId: CUSTOMER, mergedCustomerId: "m1" },
      }),
    );
  });

  it("maps a missing customer to 404 on merge", async () => {
    h.repo.merge.mockResolvedValueOnce(null);
    await expect(h.service.merge(principal(), CUSTOMER, "m1")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("lists a customer's order history", async () => {
    await expect(
      h.service.listOrders(principal(), CUSTOMER, undefined, undefined),
    ).resolves.toHaveProperty("data");
  });

  it("maps a missing customer to 404 when listing orders", async () => {
    h.repo.listCustomerOrders.mockResolvedValueOnce(null);
    await expect(
      h.service.listOrders(principal(), CUSTOMER, undefined, undefined),
    ).rejects.toMatchObject({ status: 404 });
  });
});
