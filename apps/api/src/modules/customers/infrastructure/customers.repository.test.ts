import { describe, expect, it, vi } from "vitest";
import { encodeCursor, Prisma, type PrismaClient } from "@cadeau/database";
import { blindIndex, decrypt, encrypt } from "@cadeau/crypto";
import type { InjectedAppConfig } from "../../../shared/config/config.tokens";
import {
  DuplicateCustomerError,
  InvalidListCursorError,
  ReferenceNotFoundError,
} from "../domain/customers.errors";
import { CustomersRepository, EXPORT_MAX_ROWS } from "./customers.repository";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const CREATED = new Date("2026-01-02T03:04:05.000Z");
const UPDATED = new Date("2026-01-03T03:04:05.000Z");
const PHONE = "+201001234567";

const ENCRYPTION_KEY = "000000000000000000000000000000000000000000000000000000000000ffff";
const BLIND_INDEX_KEY = "000000000000000000000000000000000000000000000000000000000000aaaa";

const config = {
  encryption: { key: ENCRYPTION_KEY, blindIndexKey: BLIND_INDEX_KEY },
} as unknown as InjectedAppConfig;

const actor = { companyId: COMPANY, actorId: ACTOR };

function customerRow(extra: Record<string, unknown> = {}) {
  return {
    id: "c1",
    name: "Ahmed",
    phoneEncrypted: encrypt(PHONE, ENCRYPTION_KEY),
    email: null,
    notes: null,
    ordersCount: 0,
    totalSpent: 0n,
    lastOrderAt: null,
    isActive: true,
    createdAt: CREATED,
    updatedAt: UPDATED,
    ...extra,
  };
}

function addressRow(extra: Record<string, unknown> = {}) {
  return {
    id: "a1",
    customerId: "c1",
    lineEncrypted: encrypt("12 Nile St", ENCRYPTION_KEY),
    landmark: null,
    notes: null,
    governorateId: null,
    isDefault: false,
    isActive: true,
    createdAt: CREATED,
    updatedAt: UPDATED,
    ...extra,
  };
}

function delegate() {
  return {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
}

function makeRepo() {
  const models = {
    customer: delegate(),
    customerAddress: delegate(),
    governorate: delegate(),
    order: delegate(),
    orderReview: delegate(),
  };
  const queryRaw = vi.fn().mockResolvedValue([]);
  const txHost = { $queryRaw: queryRaw, ...models };
  const prisma = {
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(txHost)),
  };
  const repo = new CustomersRepository(prisma as unknown as PrismaClient, config);
  return { repo, models, queryRaw };
}

/** A Prisma unique-violation on the given index. */
function uniqueViolation(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6",
    meta: { target },
  });
}

const listQuery = {
  sort: { field: "createdAt", dir: "desc" },
  active: true,
} as const;

describe("CustomersRepository — PII storage", () => {
  it("stores the phone as ciphertext plus a blind index, never as plaintext", async () => {
    const { repo, models } = makeRepo();
    models.customer.create.mockResolvedValue(customerRow());
    await repo.create(actor, { name: "Ahmed", phone: PHONE });

    const data = models.customer.create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data["phoneHash"]).toBe(blindIndex(PHONE, BLIND_INDEX_KEY));
    // The ciphertext round-trips…
    expect(decrypt(String(data["phoneEncrypted"]), ENCRYPTION_KEY)).toBe(PHONE);
    // …but no column anywhere holds the readable value.
    expect(JSON.stringify(data)).not.toContain(PHONE);
  });

  it("encrypts an address line and never stores it readable", async () => {
    const { repo, models } = makeRepo();
    models.customer.findFirst.mockResolvedValue({ id: "c1" });
    models.customerAddress.create.mockResolvedValue(addressRow());
    await repo.createAddress(actor, "c1", { line: "12 Nile St" });

    const data = models.customerAddress.create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(decrypt(String(data["lineEncrypted"]), ENCRYPTION_KEY)).toBe("12 Nile St");
    expect(JSON.stringify(data)).not.toContain("12 Nile St");
  });

  it("passes the Bosta city/district fields through on create and update", async () => {
    const { repo, models } = makeRepo();
    models.customer.findFirst.mockResolvedValue({ id: "c1" });
    models.customerAddress.create.mockResolvedValue(addressRow());
    await repo.createAddress(actor, "c1", {
      line: "12 Nile St",
      bostaCityId: "city1",
      bostaDistrictId: "district1",
      bostaCityName: "Cairo",
    });
    const created = models.customerAddress.create.mock.calls[0]?.[0]?.data as Record<
      string,
      unknown
    >;
    expect(created).toMatchObject({
      bostaCityId: "city1",
      bostaDistrictId: "district1",
      bostaCityName: "Cairo",
    });

    models.customerAddress.updateMany.mockResolvedValue({ count: 1 });
    models.customerAddress.findFirst.mockResolvedValue(addressRow());
    await repo.updateAddress(actor, "c1", "a1", { bostaCityId: null, bostaDistrictId: null });
    const updated = models.customerAddress.updateMany.mock.calls[0]?.[0]?.data as Record<
      string,
      unknown
    >;
    expect(updated).toMatchObject({ bostaCityId: null, bostaDistrictId: null });
  });

  it("re-derives BOTH phone columns together on update", async () => {
    // A ciphertext that no longer matches its blind index would make the
    // customer unfindable, so neither may be written without the other.
    const { repo, models } = makeRepo();
    models.customer.updateMany.mockResolvedValue({ count: 1 });
    models.customer.findFirst.mockResolvedValue(customerRow());
    await repo.update(actor, "c1", { phone: "+201009999999" });

    const data = models.customer.updateMany.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data["phoneHash"]).toBe(blindIndex("+201009999999", BLIND_INDEX_KEY));
    expect(decrypt(String(data["phoneEncrypted"]), ENCRYPTION_KEY)).toBe("+201009999999");
  });

  it("touches neither phone column when the patch omits the phone", async () => {
    const { repo, models } = makeRepo();
    models.customer.updateMany.mockResolvedValue({ count: 1 });
    models.customer.findFirst.mockResolvedValue(customerRow());
    await repo.update(actor, "c1", { name: "Mahmoud" });

    const data = models.customer.updateMany.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data).not.toHaveProperty("phoneHash");
    expect(data).not.toHaveProperty("phoneEncrypted");
  });

  it("produces a stable hash — the property the unique index relies on", async () => {
    const { repo, models } = makeRepo();
    models.customer.create.mockResolvedValue(customerRow());
    await repo.create(actor, { name: "A", phone: PHONE });
    await repo.create(actor, { name: "B", phone: PHONE });

    const first = models.customer.create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    const second = models.customer.create.mock.calls[1]?.[0]?.data as Record<string, unknown>;
    expect(first["phoneHash"]).toBe(second["phoneHash"]);
    // …while the ciphertext differs every time (fresh IV).
    expect(first["phoneEncrypted"]).not.toBe(second["phoneEncrypted"]);
  });
});

describe("CustomersRepository — reads", () => {
  it("binds the RLS context and returns the full phone on detail", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.customer.findFirst.mockResolvedValueOnce(customerRow());
    models.customerAddress.findMany.mockResolvedValueOnce([addressRow()]);

    const view = await repo.findById(COMPANY, "c1");
    expect(queryRaw).toHaveBeenCalled(); // setTenantContext ran
    expect(view).toMatchObject({
      id: "c1",
      name: "Ahmed",
      phone: PHONE,
      ordersCount: 0,
      totalSpent: 0,
      lastOrderAt: null,
      active: true,
      createdAt: CREATED.toISOString(),
    });
    expect(view?.addresses[0]?.line).toBe("12 Nile St");
    expect(models.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1", companyId: COMPANY } }),
    );
  });

  it("returns null for a customer absent in this tenant", async () => {
    const { repo } = makeRepo();
    await expect(repo.findById(COMPANY, "nope")).resolves.toBeNull();
  });

  it("masks the phone in a list row and exposes no full-phone field", async () => {
    const { repo, models } = makeRepo();
    models.customer.findMany.mockResolvedValue([customerRow()]);
    const page = await repo.list(COMPANY, listQuery);

    const row = page.data[0];
    expect(row?.phoneMasked).toBe("+2010•••4567");
    expect(JSON.stringify(page)).not.toContain(PHONE);
    expect(row).not.toHaveProperty("phone");
  });

  it("converts bigint money to a number", async () => {
    const { repo, models } = makeRepo();
    models.customer.findMany.mockResolvedValue([customerRow({ totalSpent: 125000n })]);
    const page = await repo.list(COMPANY, listQuery);
    expect(page.data[0]?.totalSpent).toBe(125000);
  });

  it("degrades one row with an undecryptable phone instead of failing the whole list", async () => {
    const { repo, models } = makeRepo();
    // Ciphertext from a key rotation the current ENCRYPTION_KEY can no longer open.
    const staleCipherText = encrypt(PHONE, BLIND_INDEX_KEY);
    models.customer.findMany.mockResolvedValue([
      customerRow({ id: "c-stale", phoneEncrypted: staleCipherText }),
      customerRow({ id: "c-fine" }),
    ]);

    const page = await repo.list(COMPANY, listQuery);

    expect(page.data[0]).toMatchObject({ id: "c-stale", phoneMasked: "[تعذّر فك التشفير]" });
    expect(page.data[1]).toMatchObject({ id: "c-fine", phoneMasked: "+2010•••4567" });
  });

  it("degrades a detail view's phone the same way, without throwing", async () => {
    const { repo, models } = makeRepo();
    const staleCipherText = encrypt(PHONE, BLIND_INDEX_KEY);
    models.customer.findFirst.mockResolvedValueOnce(
      customerRow({ phoneEncrypted: staleCipherText }),
    );
    models.customerAddress.findMany.mockResolvedValueOnce([]);

    const view = await repo.findById(COMPANY, "c1");
    expect(view?.phone).toBe("[تعذّر فك التشفير]");
  });

  it("degrades an undecryptable address line the same way", async () => {
    const { repo, models } = makeRepo();
    const staleCipherText = encrypt("12 Nile St", BLIND_INDEX_KEY);
    models.customer.findFirst.mockResolvedValueOnce(customerRow());
    models.customerAddress.findMany.mockResolvedValueOnce([
      addressRow({ lineEncrypted: staleCipherText }),
    ]);

    const view = await repo.findById(COMPANY, "c1");
    expect(view?.addresses[0]?.line).toBe("[تعذّر فك التشفير]");
  });
});

describe("CustomersRepository — export", () => {
  it("returns full phones, unpaginated, capped at the server maximum", async () => {
    const { repo, models, queryRaw } = makeRepo();
    models.customer.findMany.mockResolvedValue([customerRow()]);

    const rows = await repo.exportAll(COMPANY, listQuery);

    expect(queryRaw).toHaveBeenCalled(); // setTenantContext ran
    expect(rows[0]?.phone).toBe(PHONE);
    expect(models.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: EXPORT_MAX_ROWS }),
    );
  });

  it("honours a smaller caller limit but never a larger one", async () => {
    const { repo, models } = makeRepo();

    await repo.exportAll(COMPANY, { ...listQuery, limit: 10 });
    expect(models.customer.findMany.mock.calls[0]?.[0]?.take).toBe(10);

    await repo.exportAll(COMPANY, { ...listQuery, limit: EXPORT_MAX_ROWS * 10 });
    expect(models.customer.findMany.mock.calls[1]?.[0]?.take).toBe(EXPORT_MAX_ROWS);
  });
});

describe("CustomersRepository — search", () => {
  it("matches an exact phone by hashing the term, not by scanning ciphertext", async () => {
    const { repo, models } = makeRepo();
    await repo.list(COMPANY, { ...listQuery, search: { kind: "phone", e164: PHONE } });

    const where = models.customer.findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where["phoneHash"]).toBe(blindIndex(PHONE, BLIND_INDEX_KEY));
    expect(where).not.toHaveProperty("OR");
  });

  it("searches name and email for a text term, and never the phone", async () => {
    const { repo, models } = makeRepo();
    await repo.list(COMPANY, { ...listQuery, search: { kind: "text", term: "Ahmed" } });

    const where = models.customer.findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where).not.toHaveProperty("phoneHash");
    expect(JSON.stringify(where["OR"])).toContain("Ahmed");
    expect(JSON.stringify(where["OR"])).not.toContain("phone");
  });

  it("filters by governorate through the customer's addresses", async () => {
    const { repo, models } = makeRepo();
    await repo.list(COMPANY, { ...listQuery, governorateId: "g1" });
    const where = models.customer.findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where["addresses"]).toEqual({ some: { governorateId: "g1" } });
  });

  it("applies the created-at bounds", async () => {
    const { repo, models } = makeRepo();
    await repo.list(COMPANY, {
      ...listQuery,
      createdAtFrom: "2026-01-01T00:00:00.000Z",
      createdAtTo: "2026-02-01T00:00:00.000Z",
    });
    const where = models.customer.findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where["createdAt"]).toEqual({
      gte: new Date("2026-01-01T00:00:00.000Z"),
      lte: new Date("2026-02-01T00:00:00.000Z"),
    });
  });

  it("honours the active tri-state", async () => {
    const { repo, models } = makeRepo();
    await repo.list(COMPANY, { ...listQuery, active: "all" });
    const where = models.customer.findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where).not.toHaveProperty("isActive");
  });
});

describe("CustomersRepository — keyset cursors", () => {
  it("carries only sort keys in the cursor, never personal data", async () => {
    const { repo, models } = makeRepo();
    models.customer.findMany.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => customerRow({ id: `c${i}` })),
    );
    const page = await repo.list(COMPANY, { ...listQuery, limit: 2 });
    const cursor = page.page.nextCursor;
    expect(cursor).not.toBeNull();
    const decoded = Buffer.from(String(cursor), "base64url").toString("utf8");
    expect(decoded).not.toContain(PHONE);
    expect(decoded).not.toContain("Ahmed");
  });

  it("rejects a tampered cursor with a domain error", async () => {
    const { repo } = makeRepo();
    await expect(
      repo.list(COMPANY, { ...listQuery, cursor: "not-a-cursor" }),
    ).rejects.toBeInstanceOf(InvalidListCursorError);
  });
});

describe("CustomersRepository — idempotency", () => {
  it("replays a stored row for a repeated key and writes nothing", async () => {
    const { repo, models } = makeRepo();
    models.customer.findFirst.mockResolvedValue(customerRow());
    const result = await repo.create(actor, { name: "A", phone: PHONE, idempotencyKey: "k1" });

    expect(result.replayed).toBe(true);
    expect(result.customer.id).toBe("c1");
    expect(models.customer.create).not.toHaveBeenCalled();
  });

  it("does not look for a replay when no key was supplied", async () => {
    const { repo, models } = makeRepo();
    models.customer.create.mockResolvedValue(customerRow());
    const result = await repo.create(actor, { name: "A", phone: PHONE });
    expect(result.replayed).toBe(false);
    expect(models.customer.findFirst).not.toHaveBeenCalled();
  });

  it("resolves the concurrent race by replaying the winner's row", async () => {
    // Both requests passed the up-front check; one won the unique index. The
    // loser must return the winner's result, not a spurious 409.
    const { repo, models } = makeRepo();
    models.customer.findFirst
      .mockResolvedValueOnce(null) // up-front check: not there yet
      .mockResolvedValueOnce(customerRow()); // after the conflict: the winner's row
    models.customer.create.mockRejectedValue(uniqueViolation("customers_idempotency_key"));

    const result = await repo.create(actor, { name: "A", phone: PHONE, idempotencyKey: "k1" });
    expect(result.replayed).toBe(true);
    expect(result.customer.id).toBe("c1");
  });

  it("does NOT swallow a duplicate-phone conflict as a replay", async () => {
    const { repo, models } = makeRepo();
    models.customer.findFirst.mockResolvedValue(null);
    models.customer.create.mockRejectedValue(uniqueViolation("customers_company_phone_key"));

    await expect(
      repo.create(actor, { name: "A", phone: PHONE, idempotencyKey: "k1" }),
    ).rejects.toBeInstanceOf(DuplicateCustomerError);
  });
});

describe("CustomersRepository — uniqueness and references", () => {
  it("maps the phone unique index to a duplicate error naming the field", async () => {
    const { repo, models } = makeRepo();
    models.customer.create.mockRejectedValue(uniqueViolation("customers_company_phone_key"));
    await expect(repo.create(actor, { name: "A", phone: PHONE })).rejects.toMatchObject({
      field: "phone",
    });
  });

  it("never names the colliding row in the error", async () => {
    const { repo, models } = makeRepo();
    models.customer.create.mockRejectedValue(uniqueViolation("customers_company_phone_key"));
    const error = await repo.create(actor, { name: "A", phone: PHONE }).catch((e: unknown) => e);
    expect((error as Error).message).not.toContain("c1");
  });

  it("rejects an unknown governorate with a reference error", async () => {
    const { repo, models } = makeRepo();
    models.customer.findFirst.mockResolvedValue({ id: "c1" });
    await expect(
      repo.createAddress(actor, "c1", { line: "x", governorateId: "missing" }),
    ).rejects.toBeInstanceOf(ReferenceNotFoundError);
  });

  it("accepts an address with no governorate without a lookup", async () => {
    const { repo, models } = makeRepo();
    models.customer.findFirst.mockResolvedValue({ id: "c1" });
    models.customerAddress.create.mockResolvedValue(addressRow());
    await repo.createAddress(actor, "c1", { line: "x" });
    expect(models.governorate.findFirst).not.toHaveBeenCalled();
  });
});

describe("CustomersRepository — default address", () => {
  it("demotes the incumbent before promoting a new default on create", async () => {
    const { repo, models } = makeRepo();
    models.customer.findFirst.mockResolvedValue({ id: "c1" });
    models.customerAddress.create.mockResolvedValue(addressRow({ isDefault: true }));
    await repo.createAddress(actor, "c1", { line: "x", isDefault: true });

    const where = models.customerAddress.updateMany.mock.calls[0]?.[0]?.where as Record<
      string,
      unknown
    >;
    expect(where).toMatchObject({ customerId: "c1", isDefault: true });
  });

  it("excludes the row being promoted when demoting on update", async () => {
    const { repo, models } = makeRepo();
    models.customerAddress.updateMany.mockResolvedValue({ count: 1 });
    models.customerAddress.findFirst.mockResolvedValue(addressRow({ isDefault: true }));
    await repo.updateAddress(actor, "c1", "a1", { isDefault: true });

    const where = models.customerAddress.updateMany.mock.calls[0]?.[0]?.where as Record<
      string,
      unknown
    >;
    expect(where["NOT"]).toEqual({ id: "a1" });
  });

  it("does not demote anything when isDefault was not requested", async () => {
    const { repo, models } = makeRepo();
    models.customerAddress.updateMany.mockResolvedValue({ count: 1 });
    models.customerAddress.findFirst.mockResolvedValue(addressRow());
    await repo.updateAddress(actor, "c1", "a1", { landmark: "Blue gate" });
    expect(models.customerAddress.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe("CustomersRepository — writes scope to the tenant", () => {
  it("archives only within the acting company", async () => {
    const { repo, models } = makeRepo();
    models.customer.updateMany.mockResolvedValue({ count: 1 });
    models.customer.findFirst.mockResolvedValue(customerRow({ isActive: false }));
    const view = await repo.archive(actor, "c1");

    expect(models.customer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1", companyId: COMPANY } }),
    );
    expect(view?.active).toBe(false);
  });

  it("returns null when the row belongs to another tenant", async () => {
    const { repo } = makeRepo();
    await expect(repo.archive(actor, "c1")).resolves.toBeNull();
    await expect(repo.update(actor, "c1", { name: "x" })).resolves.toBeNull();
  });

  it("returns null when adding an address to an absent customer", async () => {
    const { repo } = makeRepo();
    await expect(repo.createAddress(actor, "nope", { line: "x" })).resolves.toBeNull();
  });
});

describe("CustomersRepository — EPIC-11 list & order history", () => {
  it("filters by hasOrders as a column predicate", async () => {
    const { repo, models } = makeRepo();
    await repo.list(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
      active: true,
      hasOrders: true,
    });
    const where = models.customer.findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where["ordersCount"]).toEqual({ gt: 0 });

    const { repo: r2, models: m2 } = makeRepo();
    await r2.list(COMPANY, {
      sort: { field: "createdAt", dir: "desc" },
      active: true,
      hasOrders: false,
    });
    const where2 = m2.customer.findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where2["ordersCount"]).toBe(0);
  });

  it("sorts by the ordersCount KPI with a numeric cursor", async () => {
    const { repo, models } = makeRepo();
    models.customer.findMany.mockResolvedValue([customerRow({ ordersCount: 4 })]);
    const page = await repo.list(COMPANY, {
      sort: { field: "ordersCount", dir: "desc" },
      active: true,
    });
    expect(page.data).toHaveLength(1);
    expect(models.customer.findMany.mock.calls[0]?.[0]?.orderBy).toEqual([
      { ordersCount: "desc" },
      { id: "desc" },
    ]);
  });

  it("paginates a totalSpent sort with a numeric cursor", async () => {
    const { repo, models } = makeRepo();
    models.customer.findMany.mockResolvedValue([customerRow({ totalSpent: 12000n })]);
    const cursor = encodeCursor({ p: "20000", t: "c0" });
    const page = await repo.list(COMPANY, {
      sort: { field: "totalSpent", dir: "desc" },
      active: true,
      cursor,
    });
    expect(page.data[0]?.totalSpent).toBe(12000);
    // The keyset predicate compared numerically (Number(cursor.p)).
    const where = models.customer.findMany.mock.calls[0]?.[0]?.where as {
      AND?: { OR: { totalSpent?: { lt: number } }[] }[];
    };
    expect(where.AND?.[0]?.OR?.[0]?.totalSpent).toEqual({ lt: 20000 });
  });

  it("rejects a non-numeric cursor on a KPI sort", async () => {
    const { repo } = makeRepo();
    const bad = encodeCursor({ p: "not-a-number", t: "c0" });
    await expect(
      repo.list(COMPANY, {
        sort: { field: "ordersCount", dir: "desc" },
        active: true,
        cursor: bad,
      }),
    ).rejects.toBeInstanceOf(InvalidListCursorError);
  });

  it("lists a customer's orders, or null when the customer is absent", async () => {
    const { repo, models } = makeRepo();
    models.customer.findFirst.mockResolvedValue({ id: "c1" });
    models.order.findMany.mockResolvedValue([
      {
        id: "o1",
        orderNumber: 1042n,
        status: "processing",
        total: 35000n,
        collectedAmount: 0n,
        createdAt: CREATED,
        review: null,
      },
    ]);
    const page = await repo.listCustomerOrders(COMPANY, "c1", undefined, undefined);
    expect(page?.data[0]).toMatchObject({
      orderNumber: 1042,
      status: "processing",
      total: 35000,
      review: null,
    });

    models.customer.findFirst.mockResolvedValue(null);
    expect(await repo.listCustomerOrders(COMPANY, "missing", undefined, undefined)).toBeNull();
  });

  it("includes the order's review summary, with the average computed from it", async () => {
    const { repo, models } = makeRepo();
    models.customer.findFirst.mockResolvedValue({ id: "c1" });
    models.order.findMany.mockResolvedValue([
      {
        id: "o1",
        orderNumber: 1042n,
        status: "delivered",
        total: 35000n,
        collectedAmount: 35000n,
        createdAt: CREATED,
        review: {
          id: "r1",
          productType: "clothes",
          qualityRating: 5,
          packagingRating: 4,
          shippingRating: 3,
          createdAt: CREATED,
        },
      },
    ]);
    const page = await repo.listCustomerOrders(COMPANY, "c1", undefined, undefined);
    expect(page?.data[0]?.review).toMatchObject({
      id: "r1",
      productType: "clothes",
      averageRating: 4,
    });
  });
});
