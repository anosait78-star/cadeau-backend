import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type {
  CustomerAddressView,
  CustomerListView,
  CustomerView,
  CustomerWithAddresses,
} from "../domain/customer.entity";
import type { CustomersService } from "../application/customers.service";
import { CustomersController } from "./customers.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

const CUSTOMER = "33333333-3333-3333-3333-333333333333";

function customer(extra: Partial<CustomerView> = {}): CustomerView {
  return {
    id: CUSTOMER,
    name: "Sara",
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

function listRow(): CustomerListView {
  return {
    id: CUSTOMER,
    name: "Sara",
    phoneMasked: "+2010•••4567",
    email: null,
    ordersCount: 0,
    totalSpent: 0,
    lastOrderAt: null,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function address(): CustomerAddressView {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    customerId: CUSTOMER,
    line: "12 Nile St",
    landmark: null,
    notes: null,
    governorateId: null,
    isDefault: true,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function page(rows: CustomerListView[]): KeysetPage<CustomerListView> {
  return { data: rows, page: { limit: 25, nextCursor: null, hasMore: false } };
}

function fakeResponse(): Response {
  return { status: vi.fn(), setHeader: vi.fn() } as unknown as Response;
}

/** A fully-mocked service: every public method replaced by a vitest mock fn. */
type ServiceMock = { [K in keyof CustomersService]: ReturnType<typeof vi.fn> };

describe("CustomersController", () => {
  let service: ServiceMock;
  let controller: CustomersController;

  beforeEach(() => {
    service = {
      list: vi.fn().mockResolvedValue(page([listRow()])),
      export: vi.fn().mockResolvedValue([customer()]),
      getOne: vi.fn(),
      create: vi.fn().mockResolvedValue({ customer: customer(), replayed: false }),
      update: vi.fn().mockResolvedValue(customer({ name: "Sara A." })),
      archive: vi.fn().mockResolvedValue(undefined),
      listAddresses: vi.fn().mockResolvedValue([address()]),
      createAddress: vi.fn().mockResolvedValue(address()),
      updateAddress: vi.fn().mockResolvedValue(address()),
      listOrders: vi
        .fn()
        .mockResolvedValue({ data: [], page: { limit: 25, nextCursor: null, hasMore: false } }),
      merge: vi.fn().mockResolvedValue({ survivingCustomerId: CUSTOMER, mergedCustomerId: "m1" }),
    };
    controller = new CustomersController(service as unknown as CustomersService);
  });

  it("maps the list to the envelope DTO with a masked phone only", async () => {
    const dto = await controller.list(principal, { active: "all" });

    expect(dto.data[0]).toMatchObject({ id: CUSTOMER, phoneMasked: "+2010•••4567" });
    expect(dto.data[0]).not.toHaveProperty("phone");
    expect(dto.page).toEqual({ limit: 25, nextCursor: null, hasMore: false });
    expect(service.list).toHaveBeenCalledWith(principal, { active: "all" });
  });

  it("never exposes a KPI write path on the create payload", async () => {
    const res = fakeResponse();
    await controller.create(principal, { name: "Sara", phone: "+201001234567" }, undefined, res);

    const [, sent] = service.create.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(sent).not.toHaveProperty("ordersCount");
    expect(sent).not.toHaveProperty("totalSpent");
    expect(sent).not.toHaveProperty("lastOrderAt");
  });

  it("create sets 201 + Location and returns the full phone", async () => {
    const res = fakeResponse();
    const dto = await controller.create(
      principal,
      { name: "Sara", phone: "+201001234567" },
      undefined,
      res,
    );

    expect(dto.phone).toBe("+201001234567");
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.setHeader).toHaveBeenCalledWith("Location", `/v1/customers/${CUSTOMER}`);
    expect(service.create.mock.calls[0]?.[1]).not.toHaveProperty("idempotencyKey");
  });

  it("passes an Idempotency-Key through and answers a replay with 200", async () => {
    service.create.mockResolvedValue({ customer: customer(), replayed: true });
    const res = fakeResponse();

    await controller.create(principal, { name: "Sara", phone: "+201001234567" }, "key-1", res);

    expect(service.create).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({ idempotencyKey: "key-1" }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("getOne maps the detail with its addresses", async () => {
    const detail: CustomerWithAddresses = { ...customer(), addresses: [address()] };
    service.getOne.mockResolvedValue(detail);

    const dto = await controller.getOne(principal, CUSTOMER);

    expect(dto.phone).toBe("+201001234567");
    expect(dto.addresses[0]).toMatchObject({ line: "12 Nile St", isDefault: true });
  });

  it("update forwards the patch and returns the DTO", async () => {
    const dto = await controller.update(principal, CUSTOMER, { name: "Sara A." });

    expect(dto.name).toBe("Sara A.");
    expect(service.update).toHaveBeenCalledWith(principal, CUSTOMER, { name: "Sara A." });
  });

  it("archive delegates and returns nothing", async () => {
    await expect(controller.archive(principal, CUSTOMER)).resolves.toBeUndefined();
    expect(service.archive).toHaveBeenCalledWith(principal, CUSTOMER);
  });

  it("export folds the body into the list query shape and reports the count", async () => {
    const dto = await controller.export(principal, { active: "all", limit: 10 });

    expect(dto.count).toBe(1);
    expect(dto.data[0]?.phone).toBe("+201001234567");
    expect(service.export).toHaveBeenCalledWith(principal, { active: "all", limit: "10" });
  });

  it("export omits absent filters rather than sending undefined", async () => {
    await controller.export(principal, {});
    expect(service.export).toHaveBeenCalledWith(principal, {});
  });

  it("lists addresses under the customer", async () => {
    const dto = await controller.listAddresses(principal, CUSTOMER);
    expect(dto.data).toHaveLength(1);
    expect(service.listAddresses).toHaveBeenCalledWith(principal, CUSTOMER);
  });

  it("createAddress sets 201 + a nested Location", async () => {
    const res = fakeResponse();
    const dto = await controller.createAddress(principal, CUSTOMER, { line: "12 Nile St" }, res);

    expect(dto.id).toBe("44444444-4444-4444-4444-444444444444");
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.setHeader).toHaveBeenCalledWith(
      "Location",
      `/v1/customers/${CUSTOMER}/addresses/44444444-4444-4444-4444-444444444444`,
    );
  });

  it("updateAddress forwards both ids and the patch", async () => {
    await controller.updateAddress(principal, CUSTOMER, "a1", { isDefault: true });
    expect(service.updateAddress).toHaveBeenCalledWith(principal, CUSTOMER, "a1", {
      isDefault: true,
    });
  });

  it("merge forwards the surviving and merged ids", async () => {
    const res = await controller.merge(principal, {
      survivingCustomerId: CUSTOMER,
      mergedCustomerId: "m1",
    });
    expect(service.merge).toHaveBeenCalledWith(principal, CUSTOMER, "m1");
    expect(res.survivingCustomerId).toBe(CUSTOMER);
  });

  it("listOrders forwards the id and pagination", async () => {
    const res = await controller.listOrders(principal, CUSTOMER, "25", undefined);
    expect(service.listOrders).toHaveBeenCalledWith(principal, CUSTOMER, "25", undefined);
    expect(res.data).toHaveLength(0);
  });
});
