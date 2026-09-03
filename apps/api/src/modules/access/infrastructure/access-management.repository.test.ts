import type { PrismaClient } from "@cadeau/database";
import { encodeCursor } from "@cadeau/database";
import { describe, expect, it } from "vitest";
import { InvalidCursorInputError } from "../domain/access.errors";
import { AccessManagementRepository } from "./access-management.repository";

const COMPANY = "9f1c8f00-0000-4000-8000-000000000001";
const ADMIN = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

interface Row {
  [key: string]: unknown;
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v !== null && typeof v === "object" && "not" in (v as Row)) {
      return row[k] !== (v as Row)["not"];
    }
    return row[k] === v;
  });
}

/** Minimal Prisma double covering exactly the calls the repository makes. */
class FakePrisma {
  members: Row[] = [];
  memberPerms: Row[] = [];
  featureFlags: Row[] = [];
  subscriptions: Row[] = [];
  companies: Row[] = [];
  plans: Row[] = [];
  features: Row[] = [];
  templates: Row[] = [];

  feature = {
    findMany: () => Promise.resolve(this.features),
    findUnique: ({ where }: { where: Row }) =>
      Promise.resolve(this.features.find((f) => f["key"] === where["key"]) ?? null),
  };
  permissionTemplate = {
    findMany: (args?: { select?: Row }) =>
      Promise.resolve(
        args?.select && "permissions" in args.select
          ? this.templates
          : this.templates.map((t) => ({ key: t["key"] })),
      ),
  };
  plan = {
    findUnique: ({ where }: { where: Row }) =>
      Promise.resolve(this.plans.find((p) => p["code"] === where["code"]) ?? null),
  };
  company = {
    findMany: () =>
      Promise.resolve(
        this.companies.map((c) => ({
          ...c,
          subscription: null,
        })),
      ),
  };
  companyMember = {
    findFirst: ({ where }: { where: Row }) =>
      Promise.resolve(this.members.find((m) => matches(m, where)) ?? null),
    updateMany: ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const m of this.members) {
        if (matches(m, where)) {
          Object.assign(m, data);
          count += 1;
        }
      }
      return Promise.resolve({ count });
    },
    count: ({ where }: { where: Row }) =>
      Promise.resolve(this.members.filter((m) => matches(m, where)).length),
  };
  memberPermission = {
    findMany: ({ where }: { where: Row }) =>
      Promise.resolve(
        this.memberPerms
          .filter((p) => matches(p, where))
          .map((p) => ({ permissionKey: p["permissionKey"], granted: p["granted"] })),
      ),
    deleteMany: ({ where }: { where: Row }) => {
      this.memberPerms = this.memberPerms.filter((p) => !matches(p, where));
      return Promise.resolve({ count: 0 });
    },
    create: ({ data }: { data: Row }) => {
      this.memberPerms.push(data);
      return Promise.resolve(data);
    },
  };
  addOnFeatureKeys: string[] = [];
  permissions: Row[] = [];
  featurePermissionEdges: Row[] = [];

  addOn = {
    findMany: () => Promise.resolve(this.addOnFeatureKeys.map((featureKey) => ({ featureKey }))),
  };
  permission = {
    findMany: () => Promise.resolve(this.permissions),
  };
  featurePermission = {
    findMany: () => Promise.resolve(this.featurePermissionEdges),
  };

  companyFeatureFlag = {
    findMany: ({ where }: { where: Row }) =>
      Promise.resolve(
        this.featureFlags
          .filter((f) => matches(f, where))
          .map((f) => ({ featureKey: f["featureKey"], enabled: f["enabled"] })),
      ),
    findFirst: ({ where }: { where: Row }) =>
      Promise.resolve(this.featureFlags.find((f) => matches(f, where)) ?? null),
    create: ({ data }: { data: Row }) => {
      this.featureFlags.push({ id: `f${this.featureFlags.length}`, ...data });
      return Promise.resolve(data);
    },
    updateMany: ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const f of this.featureFlags) {
        if (matches(f, where)) {
          Object.assign(f, data);
          count += 1;
        }
      }
      return Promise.resolve({ count });
    },
  };
  subscription = {
    findUnique: ({ where }: { where: Row }) =>
      Promise.resolve(this.subscriptions.find((s) => matches(s, where)) ?? null),
    create: ({ data }: { data: Row }) => {
      this.subscriptions.push({ id: `s${this.subscriptions.length}`, ...data });
      return Promise.resolve(data);
    },
    updateMany: ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const s of this.subscriptions) {
        if (matches(s, where)) {
          Object.assign(s, data);
          count += 1;
        }
      }
      return Promise.resolve({ count });
    },
  };
  $queryRaw = () => Promise.resolve([]);
  $transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(this);
}

function make(): { repo: AccessManagementRepository; db: FakePrisma } {
  const db = new FakePrisma();
  return { repo: new AccessManagementRepository(db as unknown as PrismaClient), db };
}

describe("AccessManagementRepository — catalog reads", () => {
  it("maps the feature catalog and template keys", async () => {
    const { repo, db } = make();
    db.features.push({ key: "orders", name: "Orders", category: "operations", isActive: true });
    db.templates.push({ key: "owner", name: "Owner", description: null, permissions: [] });

    expect(await repo.listFeatureCatalog()).toEqual([
      { key: "orders", name: "Orders", category: "operations", isActive: true },
    ]);
    expect(await repo.listTemplateKeys()).toEqual(["owner"]);
    expect(await repo.featureExists("orders")).toBe(true);
    expect(await repo.featureExists("nope")).toBe(false);
  });

  it("maps permission templates with their permission keys", async () => {
    const { repo, db } = make();
    db.templates.push({
      key: "owner",
      name: "Owner",
      description: "All",
      permissions: [{ permissionKey: "orders.read" }],
    });
    expect(await repo.listPermissionTemplates()).toEqual([
      { key: "owner", name: "Owner", description: "All", permissions: ["orders.read"] },
    ]);
  });
});

describe("AccessManagementRepository — listAvailablePermissions", () => {
  it("returns the whole catalog, flagging what the company can actually grant", async () => {
    const { repo, db } = make();
    db.subscriptions.push({ companyId: COMPANY, plan: { features: [{ featureKey: "orders" }] } });
    db.features.push({ key: "orders" }, { key: "customers" });
    db.permissions.push(
      { key: "access.read", description: "View access" },
      { key: "orders.read", description: "View orders" },
      { key: "orders.manage", description: "Manage orders" },
      { key: "customers.read", description: "View customers" },
    );
    db.featurePermissionEdges.push(
      { featureKey: "orders", permissionKey: "orders.read" },
      { featureKey: "orders", permissionKey: "orders.manage" },
      { featureKey: "customers", permissionKey: "customers.read" },
    );

    const result = await repo.listAvailablePermissions(COMPANY);

    expect(result).toEqual([
      { key: "access.read", description: "View access", featureKey: null, available: true },
      { key: "orders.read", description: "View orders", featureKey: "orders", available: true },
      { key: "orders.manage", description: "Manage orders", featureKey: "orders", available: true },
      // Out of plan — listed so the picker can show it disabled, not omitted.
      {
        key: "customers.read",
        description: "View customers",
        featureKey: "customers",
        available: false,
      },
    ]);
  });

  it("marks a feature-flagged-off permission unavailable", async () => {
    const { repo, db } = make();
    db.subscriptions.push({
      companyId: COMPANY,
      plan: { features: [{ featureKey: "orders" }, { featureKey: "customers" }] },
    });
    db.features.push({ key: "orders" }, { key: "customers" });
    db.featureFlags.push({ companyId: COMPANY, featureKey: "customers", enabled: false });
    db.permissions.push(
      { key: "orders.read", description: null },
      { key: "customers.read", description: null },
    );
    db.featurePermissionEdges.push(
      { featureKey: "orders", permissionKey: "orders.read" },
      { featureKey: "customers", permissionKey: "customers.read" },
    );

    const result = await repo.listAvailablePermissions(COMPANY);

    expect(result.map((p) => [p.key, p.available])).toEqual([
      ["orders.read", true],
      ["customers.read", false],
    ]);
  });

  it("marks only the core permissions available when the company has no subscription", async () => {
    const { repo, db } = make();
    db.permissions.push(
      { key: "access.read", description: null },
      { key: "access.manage", description: null },
      { key: "orders.read", description: null },
    );
    db.featurePermissionEdges.push({ featureKey: "orders", permissionKey: "orders.read" });

    const result = await repo.listAvailablePermissions(COMPANY);

    expect(
      result
        .filter((p) => p.available)
        .map((p) => p.key)
        .sort(),
    ).toEqual(["access.manage", "access.read"]);
    expect(result.map((p) => p.key).sort()).toEqual([
      "access.manage",
      "access.read",
      "orders.read",
    ]);
  });
});

describe("AccessManagementRepository — member assignment", () => {
  it("updates the role, replaces overrides, and returns before/after", async () => {
    const { repo, db } = make();
    db.members.push({ id: "m1", companyId: COMPANY, userId: "u2", role: "member" });

    const result = await repo.assignMemberPermissions({
      companyId: COMPANY,
      memberId: "m1",
      actorId: "actor",
      templateKey: "store_manager",
      overrides: [{ key: "orders.manage", granted: true }],
    });

    expect(result.before).toEqual({ role: "member", overrides: [] });
    expect(result.after.role).toBe("store_manager");
    expect(result.after.overrides).toEqual([{ key: "orders.manage", granted: true }]);
    expect(result.memberUserId).toBe("u2");
  });

  it("throws when the member is missing", async () => {
    const { repo } = make();
    await expect(
      repo.assignMemberPermissions({ companyId: COMPANY, memberId: "ghost", actorId: "a" }),
    ).rejects.toThrow();
  });
});

describe("AccessManagementRepository — owner queries", () => {
  it("findOwnRole returns the caller's active role, or null when not an active member", async () => {
    const { repo, db } = make();
    db.members.push(
      { id: "m1", companyId: COMPANY, userId: "u1", role: "owner", status: "active" },
      { id: "m2", companyId: COMPANY, userId: "u2", role: "member", status: "inactive" },
    );

    expect(await repo.findOwnRole(COMPANY, "u1")).toBe("owner");
    expect(await repo.findOwnRole(COMPANY, "u2")).toBeNull();
    expect(await repo.findOwnRole(COMPANY, "ghost")).toBeNull();
  });

  it("hasOtherActiveOwner ignores the excluded member and inactive owners", async () => {
    const { repo, db } = make();
    db.members.push(
      { id: "m1", companyId: COMPANY, userId: "u1", role: "owner", status: "active" },
      { id: "m2", companyId: COMPANY, userId: "u2", role: "owner", status: "inactive" },
    );

    expect(await repo.hasOtherActiveOwner(COMPANY, "m1")).toBe(false);

    db.members.push({
      id: "m3",
      companyId: COMPANY,
      userId: "u3",
      role: "owner",
      status: "active",
    });
    expect(await repo.hasOtherActiveOwner(COMPANY, "m1")).toBe(true);
  });
});

describe("AccessManagementRepository — admin ops", () => {
  it("paginates companies and rejects a bad cursor", async () => {
    const { repo, db } = make();
    db.companies.push({
      id: COMPANY,
      name: "Acme",
      slug: "acme",
      status: "active",
      createdAt: new Date("2026-01-01"),
    });
    const page = await repo.listAllCompanies(ADMIN, undefined, undefined);
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.planCode).toBeNull();

    await expect(repo.listAllCompanies(ADMIN, 10, "!!not-base64!!")).rejects.toBeInstanceOf(
      InvalidCursorInputError,
    );
    // A well-formed cursor missing required keys is also rejected.
    await expect(
      repo.listAllCompanies(ADMIN, 10, encodeCursor({ foo: "bar" })),
    ).rejects.toBeInstanceOf(InvalidCursorInputError);
  });

  it("creates then updates a feature flag and a subscription", async () => {
    const { repo, db } = make();
    db.plans.push({ id: "p1", code: "pro" });

    await repo.setCompanyFeatureFlag({
      companyId: COMPANY,
      featureKey: "analytics",
      enabled: true,
      actorId: "a",
    });
    expect(db.featureFlags).toHaveLength(1);
    await repo.setCompanyFeatureFlag({
      companyId: COMPANY,
      featureKey: "analytics",
      enabled: false,
      actorId: "a",
    });
    expect(db.featureFlags[0]?.["enabled"]).toBe(false);

    expect(await repo.findPlanByCode("pro")).toEqual({ id: "p1", code: "pro" });
    await repo.setSubscription({ companyId: COMPANY, planId: "p1", actorId: "a" });
    expect(db.subscriptions).toHaveLength(1);
    await repo.setSubscription({ companyId: COMPANY, planId: "p2", actorId: "a" });
    expect(db.subscriptions[0]?.["planId"]).toBe("p2");
  });
});
