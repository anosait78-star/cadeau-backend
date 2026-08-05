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
  readonly plans: Row[] = [{ id: "plan-pro", code: "pro" }];
  readonly subscriptions: Row[] = [];
  readonly queryRaw = vi.fn(() => Promise.resolve([]));

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
    findMany: ({ where }: { where: Row }) =>
      Promise.resolve(
        this.members
          .filter((m) => matches(m, where))
          .map((m) => ({
            role: m["role"],
            status: m["status"],
            company: this.companies.find((c) => c["id"] === m["companyId"]) ?? {
              id: m["companyId"],
              name: "",
              slug: null,
            },
          })),
      ),
    findFirst: ({ where }: { where: Row }) =>
      Promise.resolve(this.members.find((m) => matches(m, where)) ?? null),
    create: ({ data }: { data: Row }) => {
      const row: Row = { createdAt: new Date(), ...data };
      this.members.push(row);
      return Promise.resolve(row);
    },
  };

  invitation = {
    create: ({ data }: { data: Row }) => {
      const row: Row = {
        id: `inv${this.invitations.length + 1}`,
        createdAt: new Date(),
        revokedAt: null,
        ...data,
      };
      this.invitations.push(row);
      return Promise.resolve(row);
    },
    findFirst: ({ where }: { where: Row }) =>
      Promise.resolve(this.invitations.find((i) => matches(i, where)) ?? null),
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
  };

  $transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({
      profile: this.profile,
      company: this.company,
      companyMember: this.companyMember,
      invitation: this.invitation,
      plan: this.plan,
      subscription: this.subscription,
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
});
