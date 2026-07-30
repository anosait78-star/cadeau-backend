import { Prisma, type PrismaClient } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import { SlugAlreadyTakenError } from "../domain/tenancy.errors";
import { TenancyRepository } from "./tenancy.repository";

const USER = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const USER2 = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const COMPANY = "9f1c8f00-0000-4000-8000-000000000001";

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

  $transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({
      profile: this.profile,
      company: this.company,
      companyMember: this.companyMember,
      invitation: this.invitation,
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

describe("TenancyRepository — createCompanyWithOwner", () => {
  it("creates a company and the owner membership atomically", async () => {
    const { repo, db } = make();
    const company = await repo.createCompanyWithOwner({
      companyId: COMPANY,
      name: "Acme",
      slug: "acme",
      userId: USER,
    });
    expect(company).toMatchObject({ id: COMPANY, name: "Acme", status: "active" });
    expect(db.members).toHaveLength(1);
    expect(db.members[0]).toMatchObject({ userId: USER, role: "owner", status: "active" });
  });

  it("maps a duplicate slug to SlugAlreadyTakenError", async () => {
    const { repo } = make();
    await repo.createCompanyWithOwner({
      companyId: COMPANY,
      name: "A",
      slug: "acme",
      userId: USER,
    });
    await expect(
      repo.createCompanyWithOwner({
        companyId: "9f1c8f00-0000-4000-8000-000000000002",
        name: "B",
        slug: "acme",
        userId: USER,
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
