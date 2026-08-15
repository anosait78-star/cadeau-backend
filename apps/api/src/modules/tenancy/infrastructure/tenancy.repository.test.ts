import { Prisma, type PrismaClient } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import { SlugAlreadyTakenError } from "../domain/tenancy.errors";
import { TenancyRepository } from "./tenancy.repository";

const USER = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const USER2 = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const COMPANY = "9f1c8f00-0000-4000-8000-000000000001";

const ONBOARDING_FIELDS = {
  phone: "+201234567890",
  monthlyOrdersRange: "100_500",
  country: "Egypt",
  facebookHandle: "facebook.com/acme",
  instagramHandle: "@acme",
  websiteUrl: "https://acme.test",
  shippingCarrier: "Aramex",
} as const;

interface Row {
  [key: string]: unknown;
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) =>
    v === null ? row[k] === null || row[k] === undefined : row[k] === v,
  );
}

/** Minimal in-memory Prisma double covering exactly the calls the repo makes. */
class FakePrisma {
  readonly profiles: Row[] = [];
  readonly companies: Row[] = [];
  readonly members: Row[] = [];
  readonly invitations: Row[] = [];
  readonly warehouseJoinCodes: Row[] = [];
  readonly plans: Row[] = [{ id: "plan-pro", code: "pro" }];
  readonly subscriptions: Row[] = [];
  readonly queryRaw = vi.fn(() => Promise.resolve([]));

  // Access-catalog fixtures for listCompanyAvailablePermissionKeys — a company
  // with `orders` on its plan and no flags/add-ons/gaps by default.
  features: string[] = ["orders", "customers"];
  planFeatureKeys: string[] = ["orders", "customers"];
  featureFlags: { featureKey: string; enabled: boolean }[] = [];
  addOnFeatureKeys: string[] = [];
  permissionKeys: string[] = [
    "access.read",
    "access.manage",
    "orders.read",
    "orders.manage",
    "customers.read",
    "customers.manage",
  ];
  featurePermissionEdges: { featureKey: string; permissionKey: string }[] = [
    { featureKey: "orders", permissionKey: "orders.read" },
    { featureKey: "orders", permissionKey: "orders.manage" },
    { featureKey: "customers", permissionKey: "customers.read" },
    { featureKey: "customers", permissionKey: "customers.manage" },
  ];
  readonly memberPermissions: Row[] = [];

  profile = {
    findFirst: ({ where }: { where: Row }) =>
      Promise.resolve(this.profiles.find((p) => matches(p, where)) ?? null),
  };

  company = {
    create: ({ data }: { data: Row }) => {
      if (data["slug"] !== null && this.companies.some((c) => c["slug"] === data["slug"])) {
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError("unique", {
            code: "P2002",
            clientVersion: "test",
          }),
        );
      }
      const row: Row = { createdAt: new Date(), ...data };
      this.companies.push(row);
      return Promise.resolve(row);
    },
    findFirst: ({ where }: { where: Row }) =>
      Promise.resolve(this.companies.find((c) => matches(c, where)) ?? null),
    updateMany: ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const c of this.companies) {
        if (matches(c, where)) {
          Object.assign(c, data);
          count += 1;
        }
      }
      return Promise.resolve({ count });
    },
  };

  companyMember = {
    findMany: ({ where, select }: { where: Row; select?: Row }) => {
      const rows = this.members.filter((m) => matches(m, where));
      if (select?.["user"] !== undefined) {
        // listMembers shape: join the member row with its Profile.
        return Promise.resolve(
          rows.map((m) => {
            const profile = this.profiles.find((p) => p["id"] === m["userId"]);
            return {
              id: m["id"],
              userId: m["userId"],
              role: m["role"],
              status: m["status"],
              createdAt: m["createdAt"],
              user: { fullName: profile?.["fullName"] ?? null, email: profile?.["email"] ?? "" },
            };
          }),
        );
      }
      // listUserCompanies shape.
      return Promise.resolve(
        rows.map((m) => ({
          role: m["role"],
          status: m["status"],
          company: this.companies.find((c) => c["id"] === m["companyId"]) ?? {
            id: m["companyId"],
            name: "",
            slug: null,
          },
        })),
      );
    },
    findFirst: ({ where }: { where: Row }) =>
      Promise.resolve(this.members.find((m) => matches(m, where)) ?? null),
    create: ({ data }: { data: Row }) => {
      const row: Row = { id: `member${this.members.length + 1}`, createdAt: new Date(), ...data };
      this.members.push(row);
      return Promise.resolve(row);
    },
    count: ({ where }: { where: Row }) =>
      Promise.resolve(this.members.filter((m) => matches(m, where)).length),
    delete: ({ where }: { where: Row }) => {
      const index = this.members.findIndex((m) => matches(m, where));
      const [removed] = index === -1 ? [null] : this.members.splice(index, 1);
      return Promise.resolve(removed);
    },
  };

  invitation = {
    create: ({ data }: { data: Row }) => {
      const row: Row = {
        id: `inv${this.invitations.length + 1}`,
        createdAt: new Date(),
        revokedAt: null,
        customPermissionKeys: [],
        ...data,
      };
      this.invitations.push(row);
      return Promise.resolve(row);
    },
    findFirst: ({ where }: { where: Row }) =>
      Promise.resolve(this.invitations.find((i) => matches(i, where)) ?? null),
    findMany: ({ where }: { where: Row }) =>
      Promise.resolve(
        [...this.invitations]
          .filter((i) => matches(i, where))
          .sort((a, b) => (b["createdAt"] as Date).getTime() - (a["createdAt"] as Date).getTime()),
      ),
    updateMany: ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const i of this.invitations) {
        if (matches(i, where)) {
          Object.assign(i, data);
          count += 1;
        }
      }
      return Promise.resolve({ count });
    },
  };

  warehouseJoinCode = {
    findFirst: ({ where }: { where: Row }) =>
      Promise.resolve(this.warehouseJoinCodes.find((c) => matches(c, where)) ?? null),
  };

  plan = {
    findUnique: ({ where }: { where: Row }) =>
      Promise.resolve(this.plans.find((p) => matches(p, where)) ?? null),
  };

  subscription = {
    create: ({ data }: { data: Row }) => {
      const row: Row = { id: `sub${this.subscriptions.length + 1}`, ...data };
      this.subscriptions.push(row);
      return Promise.resolve(row);
    },
    findUnique: ({ where }: { where: Row }) => {
      const has = this.subscriptions.some((s) => s["companyId"] === where["companyId"]);
      if (!has) return Promise.resolve(null);
      return Promise.resolve({
        plan: { features: this.planFeatureKeys.map((featureKey) => ({ featureKey })) },
      });
    },
  };

  feature = {
    findMany: () => Promise.resolve(this.features.map((key) => ({ key }))),
  };

  companyFeatureFlag = {
    findMany: () => Promise.resolve(this.featureFlags),
  };

  addOn = {
    findMany: () => Promise.resolve(this.addOnFeatureKeys.map((featureKey) => ({ featureKey }))),
  };

  permission = {
    findMany: () => Promise.resolve(this.permissionKeys.map((key) => ({ key }))),
  };

  featurePermission = {
    findMany: () => Promise.resolve(this.featurePermissionEdges),
  };

  memberPermission = {
    createMany: ({ data }: { data: Row[] }) => {
      this.memberPermissions.push(...data);
      return Promise.resolve({ count: data.length });
    },
  };

  $transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({
      profile: this.profile,
      company: this.company,
      companyMember: this.companyMember,
      invitation: this.invitation,
      warehouseJoinCode: this.warehouseJoinCode,
      plan: this.plan,
      subscription: this.subscription,
      feature: this.feature,
      companyFeatureFlag: this.companyFeatureFlag,
      addOn: this.addOn,
      permission: this.permission,
      featurePermission: this.featurePermission,
      memberPermission: this.memberPermission,
      $queryRaw: this.queryRaw,
    });
}

function make(): { repo: TenancyRepository; db: FakePrisma } {
  const db = new FakePrisma();
  return { repo: new TenancyRepository(db as unknown as PrismaClient), db };
}

describe("TenancyRepository — profile & companies", () => {
  it("finds a profile and lists the user's companies with roles", async () => {
    const { repo, db } = make();
    db.profiles.push({
      id: USER,
      email: "a@test.dev",
      fullName: "A",
      phoneEncrypted: null,
      totpEnabledAt: null,
    });
    db.companies.push({ id: COMPANY, name: "Acme", slug: "acme" });
    db.members.push({ companyId: COMPANY, userId: USER, role: "owner", status: "active" });

    expect((await repo.findProfile(USER))?.email).toBe("a@test.dev");
    const companies = await repo.listUserCompanies(USER);
    expect(companies).toEqual([
      { id: COMPANY, name: "Acme", slug: "acme", role: "owner", status: "active" },
    ]);
    // The self-service reads bind the principal via set_config.
    expect(db.queryRaw).toHaveBeenCalled();
  });
});

const TRIAL_ENDS_AT = new Date("2026-09-01T00:00:00.000Z");

describe("TenancyRepository — createCompanyWithOwner", () => {
  it("creates a company and the owner membership atomically", async () => {
    const { repo, db } = make();
    const company = await repo.createCompanyWithOwner({
      companyId: COMPANY,
      name: "Acme",
      slug: "acme",
      userId: USER,
      ...ONBOARDING_FIELDS,
      trialEndsAt: TRIAL_ENDS_AT,
    });
    expect(company).toMatchObject({
      id: COMPANY,
      name: "Acme",
      status: "active",
      phone: ONBOARDING_FIELDS.phone,
      monthlyOrdersRange: ONBOARDING_FIELDS.monthlyOrdersRange,
      country: ONBOARDING_FIELDS.country,
    });
    expect(db.members).toHaveLength(1);
    expect(db.members[0]).toMatchObject({ userId: USER, role: "owner", status: "active" });
  });

  it("grants a free pro-plan trial ending at the given date", async () => {
    const { repo, db } = make();
    await repo.createCompanyWithOwner({
      companyId: COMPANY,
      name: "Acme",
      slug: "acme",
      userId: USER,
      ...ONBOARDING_FIELDS,
      trialEndsAt: TRIAL_ENDS_AT,
    });
    expect(db.subscriptions).toHaveLength(1);
    expect(db.subscriptions[0]).toMatchObject({
      companyId: COMPANY,
      planId: "plan-pro",
      status: "trialing",
      currentPeriodEnd: TRIAL_ENDS_AT,
    });
  });

  it("still creates the company when no trial plan is seeded", async () => {
    const { repo, db } = make();
    db.plans.length = 0;
    const company = await repo.createCompanyWithOwner({
      companyId: COMPANY,
      name: "Acme",
      slug: "acme",
      userId: USER,
      ...ONBOARDING_FIELDS,
      trialEndsAt: TRIAL_ENDS_AT,
    });
    expect(company.id).toBe(COMPANY);
    expect(db.subscriptions).toHaveLength(0);
  });

  it("maps a duplicate slug to SlugAlreadyTakenError", async () => {
    const { repo } = make();
    await repo.createCompanyWithOwner({
      companyId: COMPANY,
      name: "A",
      slug: "acme",
      userId: USER,
      ...ONBOARDING_FIELDS,
      trialEndsAt: TRIAL_ENDS_AT,
    });
    await expect(
      repo.createCompanyWithOwner({
        companyId: "9f1c8f00-0000-4000-8000-000000000002",
        name: "B",
        slug: "acme",
        userId: USER,
        ...ONBOARDING_FIELDS,
        trialEndsAt: TRIAL_ENDS_AT,
      }),
    ).rejects.toBeInstanceOf(SlugAlreadyTakenError);
  });

  it("finds an active membership only when active", async () => {
    const { repo, db } = make();
    db.members.push({ companyId: COMPANY, userId: USER, role: "owner", status: "active" });
    expect(await repo.findActiveMembership(USER, COMPANY)).toMatchObject({ role: "owner" });
    expect(await repo.findActiveMembership(USER2, COMPANY)).toBeNull();
  });
});

describe("TenancyRepository — updateWhatsappCountryCode", () => {
  it("sets the prefix and binds the tenant context", async () => {
    const { repo, db } = make();
    db.companies.push({ id: COMPANY, name: "Acme", whatsappCountryCode: null });
    const updated = await repo.updateWhatsappCountryCode(COMPANY, USER, "20");
    expect(updated?.whatsappCountryCode).toBe("20");
    expect(db.queryRaw).toHaveBeenCalled();
  });

  it("returns null when the company is gone", async () => {
    const { repo } = make();
    expect(await repo.updateWhatsappCountryCode(COMPANY, USER, "20")).toBeNull();
  });
});

describe("TenancyRepository — invitations", () => {
  it("creates and revokes an invitation", async () => {
    const { repo } = make();
    const invite = await repo.createInvitation({
      companyId: COMPANY,
      email: "t@test.dev",
      role: "member",
      codeHash: "hash",
      expiresAt: new Date(Date.now() + 1000),
      actorId: USER,
    });
    expect(invite.status).toBe("pending");
    expect(
      await repo.revokeInvitation({ companyId: COMPANY, invitationId: invite.id, actorId: USER }),
    ).toBe(true);
    // Second revoke: no pending row matches.
    expect(
      await repo.revokeInvitation({ companyId: COMPANY, invitationId: invite.id, actorId: USER }),
    ).toBe(false);
  });

  it("accepts a live invite addressed to the caller, joining the company", async () => {
    const { repo, db } = make();
    await repo.createInvitation({
      companyId: COMPANY,
      email: "t@test.dev",
      role: "member",
      codeHash: "code-hash",
      expiresAt: new Date(Date.now() + 60_000),
      actorId: USER,
    });
    const outcome = await repo.acceptInvitationByCode({
      codeHash: "code-hash",
      userId: USER2,
      email: "t@test.dev",
    });
    expect(outcome).toEqual({ kind: "accepted", companyId: COMPANY, role: "member" });
    expect(db.members.some((m) => m["userId"] === USER2)).toBe(true);
    expect(db.invitations[0]?.["status"]).toBe("accepted");
  });

  it("is idempotent when the caller is already a member", async () => {
    const { repo, db } = make();
    db.members.push({ companyId: COMPANY, userId: USER2, role: "member", status: "active" });
    await repo.createInvitation({
      companyId: COMPANY,
      email: "t@test.dev",
      role: "member",
      codeHash: "code-2",
      expiresAt: new Date(Date.now() + 60_000),
      actorId: USER,
    });
    const outcome = await repo.acceptInvitationByCode({
      codeHash: "code-2",
      userId: USER2,
      email: "t@test.dev",
    });
    expect(outcome).toMatchObject({ kind: "already_member" });
  });

  it("rejects an unknown, expired, or mis-addressed code", async () => {
    const { repo } = make();
    // Unknown code.
    expect(
      await repo.acceptInvitationByCode({ codeHash: "nope", userId: USER2, email: "t@test.dev" }),
    ).toEqual({ kind: "invalid" });
    // Expired code.
    await repo.createInvitation({
      companyId: COMPANY,
      email: "t@test.dev",
      role: "member",
      codeHash: "expired",
      expiresAt: new Date(Date.now() - 1000),
      actorId: USER,
    });
    expect(
      await repo.acceptInvitationByCode({
        codeHash: "expired",
        userId: USER2,
        email: "t@test.dev",
      }),
    ).toEqual({ kind: "invalid" });
    // Wrong email.
    await repo.createInvitation({
      companyId: COMPANY,
      email: "intended@test.dev",
      role: "member",
      codeHash: "mismatch",
      expiresAt: new Date(Date.now() + 60_000),
      actorId: USER,
    });
    expect(
      await repo.acceptInvitationByCode({
        codeHash: "mismatch",
        userId: USER2,
        email: "other@test.dev",
      }),
    ).toEqual({ kind: "email_mismatch" });
  });

  it("lists invitations for the company, newest first", async () => {
    const { repo } = make();
    await repo.createInvitation({
      companyId: COMPANY,
      email: "a@test.dev",
      role: "member",
      codeHash: "list-1",
      expiresAt: new Date(Date.now() + 60_000),
      actorId: USER,
    });
    await repo.createInvitation({
      companyId: COMPANY,
      email: "b@test.dev",
      role: "custom",
      customPermissionKeys: ["orders.read"],
      codeHash: "list-2",
      expiresAt: new Date(Date.now() + 60_000),
      actorId: USER,
    });
    const list = await repo.listInvitations(COMPANY);
    expect(list).toHaveLength(2);
    expect(list.find((i) => i.email === "b@test.dev")?.customPermissionKeys).toEqual([
      "orders.read",
    ]);
  });

  it("grants exactly the custom permission keys as MemberPermission rows on accept", async () => {
    const { repo, db } = make();
    await repo.createInvitation({
      companyId: COMPANY,
      email: "custom@test.dev",
      role: "custom",
      customPermissionKeys: ["orders.read", "customers.manage"],
      codeHash: "custom-code",
      expiresAt: new Date(Date.now() + 60_000),
      actorId: USER,
    });
    const outcome = await repo.acceptInvitationByCode({
      codeHash: "custom-code",
      userId: USER2,
      email: "custom@test.dev",
    });
    expect(outcome).toMatchObject({ kind: "accepted", role: "custom" });
    const member = db.members.find((m) => m["userId"] === USER2);
    expect(member?.["role"]).toBe("custom");
    expect(db.memberPermissions).toHaveLength(2);
    expect(db.memberPermissions.map((p) => p["permissionKey"]).sort()).toEqual([
      "customers.manage",
      "orders.read",
    ]);
    expect(db.memberPermissions.every((p) => p["granted"] === true)).toBe(true);
  });
});

describe("TenancyRepository — acceptWarehouseJoinCodeByCode (Vendor Accounts, Phase 1)", () => {
  const WAREHOUSE = "9f1c8f00-0000-4000-8000-0000000000aa";

  it("joins as a vendor scoped to the code's warehouse — no email check", async () => {
    const { repo, db } = make();
    db.warehouseJoinCodes.push({
      companyId: COMPANY,
      warehouseId: WAREHOUSE,
      codeHash: "wh-code",
      isActive: true,
    });
    const outcome = await repo.acceptWarehouseJoinCodeByCode({
      codeHash: "wh-code",
      userId: USER2,
    });
    expect(outcome).toEqual({
      kind: "accepted",
      companyId: COMPANY,
      role: "vendor",
      warehouseId: WAREHOUSE,
    });
    const member = db.members.find((m) => m["userId"] === USER2);
    expect(member?.["role"]).toBe("vendor");
    expect(member?.["warehouseId"]).toBe(WAREHOUSE);
  });

  it("rejects an unknown or inactive (revoked) code", async () => {
    const { repo } = make();
    expect(await repo.acceptWarehouseJoinCodeByCode({ codeHash: "nope", userId: USER2 })).toEqual({
      kind: "invalid",
    });
    const { db } = make();
    db.warehouseJoinCodes.push({
      companyId: COMPANY,
      warehouseId: WAREHOUSE,
      codeHash: "revoked",
      isActive: false,
    });
    const repo2 = new TenancyRepository(db as unknown as PrismaClient);
    expect(
      await repo2.acceptWarehouseJoinCodeByCode({ codeHash: "revoked", userId: USER2 }),
    ).toEqual({ kind: "invalid" });
  });

  it("is idempotent when the caller is already a member", async () => {
    const { repo, db } = make();
    db.members.push({
      companyId: COMPANY,
      userId: USER2,
      role: "vendor",
      status: "active",
      warehouseId: WAREHOUSE,
    });
    db.warehouseJoinCodes.push({
      companyId: COMPANY,
      warehouseId: WAREHOUSE,
      codeHash: "wh-code-2",
      isActive: true,
    });
    const outcome = await repo.acceptWarehouseJoinCodeByCode({
      codeHash: "wh-code-2",
      userId: USER2,
    });
    expect(outcome).toEqual({
      kind: "already_member",
      companyId: COMPANY,
      role: "vendor",
      warehouseId: WAREHOUSE,
    });
    // No second membership row was created.
    expect(db.members.filter((m) => m["userId"] === USER2)).toHaveLength(1);
  });

  it("a code only ever resolves into its own company", async () => {
    const { repo, db } = make();
    const OTHER_COMPANY = "9f1c8f00-0000-4000-8000-000000000002";
    db.warehouseJoinCodes.push({
      companyId: OTHER_COMPANY,
      warehouseId: WAREHOUSE,
      codeHash: "cross-company",
      isActive: true,
    });
    const outcome = await repo.acceptWarehouseJoinCodeByCode({
      codeHash: "cross-company",
      userId: USER2,
    });
    expect(outcome).toMatchObject({ kind: "accepted", companyId: OTHER_COMPANY });
    expect(outcome).not.toMatchObject({ companyId: COMPANY });
  });
});

describe("TenancyRepository — listCompanyAvailablePermissionKeys", () => {
  it("returns permissions gated by the company's effective features only", async () => {
    const { repo, db } = make();
    db.subscriptions.push({ companyId: COMPANY, planId: "plan-pro" });
    db.planFeatureKeys = ["orders"]; // plan includes orders, not customers
    const keys = await repo.listCompanyAvailablePermissionKeys(COMPANY);
    expect(keys).toContain("orders.read");
    expect(keys).toContain("orders.manage");
    expect(keys).toContain("access.read"); // feature-independent core permission
    expect(keys).not.toContain("customers.read");
  });

  it("respects a company feature-flag override", async () => {
    const { repo, db } = make();
    db.subscriptions.push({ companyId: COMPANY, planId: "plan-pro" });
    db.planFeatureKeys = ["orders", "customers"];
    db.featureFlags = [{ featureKey: "customers", enabled: false }];
    const keys = await repo.listCompanyAvailablePermissionKeys(COMPANY);
    expect(keys).toContain("orders.read");
    expect(keys).not.toContain("customers.read");
    expect(keys).not.toContain("customers.manage");
  });

  it("returns only core permissions when the company has no subscription", async () => {
    const { repo } = make();
    const keys = await repo.listCompanyAvailablePermissionKeys(COMPANY);
    expect(keys).toEqual(["access.manage", "access.read"]);
  });
});

describe("TenancyRepository — listMembers / removeMember", () => {
  it("lists active members with their profile name/email", async () => {
    const { repo, db } = make();
    db.profiles.push({ id: USER, email: "owner@test.dev", fullName: "Owner Person" });
    db.members.push({
      id: "m1",
      companyId: COMPANY,
      userId: USER,
      role: "owner",
      status: "active",
    });
    db.members.push({
      id: "m2",
      companyId: COMPANY,
      userId: USER2,
      role: "member",
      status: "removed",
    });
    const members = await repo.listMembers(COMPANY);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      id: "m1",
      name: "Owner Person",
      email: "owner@test.dev",
      role: "owner",
    });
  });

  it("removes a non-owner member", async () => {
    const { repo, db } = make();
    db.members.push({
      id: "m1",
      companyId: COMPANY,
      userId: USER2,
      role: "member",
      status: "active",
    });
    const outcome = await repo.removeMember({ companyId: COMPANY, memberId: "m1", actorId: USER });
    expect(outcome).toEqual({ kind: "removed" });
    expect(db.members.some((m) => m["id"] === "m1")).toBe(false);
  });

  it("404s (not_found) removing an unknown member", async () => {
    const { repo } = make();
    const outcome = await repo.removeMember({
      companyId: COMPANY,
      memberId: "nope",
      actorId: USER,
    });
    expect(outcome).toEqual({ kind: "not_found" });
  });

  it("refuses to remove the last active owner", async () => {
    const { repo, db } = make();
    db.members.push({
      id: "owner1",
      companyId: COMPANY,
      userId: USER,
      role: "owner",
      status: "active",
    });
    const outcome = await repo.removeMember({
      companyId: COMPANY,
      memberId: "owner1",
      actorId: USER,
    });
    expect(outcome).toEqual({ kind: "last_owner" });
    expect(db.members.some((m) => m["id"] === "owner1")).toBe(true);
  });

  it("allows removing an owner when another active owner remains", async () => {
    const { repo, db } = make();
    db.members.push({
      id: "owner1",
      companyId: COMPANY,
      userId: USER,
      role: "owner",
      status: "active",
    });
    db.members.push({
      id: "owner2",
      companyId: COMPANY,
      userId: USER2,
      role: "owner",
      status: "active",
    });
    const outcome = await repo.removeMember({
      companyId: COMPANY,
      memberId: "owner2",
      actorId: USER,
    });
    expect(outcome).toEqual({ kind: "removed" });
    expect(db.members.some((m) => m["id"] === "owner1")).toBe(true);
  });
});
