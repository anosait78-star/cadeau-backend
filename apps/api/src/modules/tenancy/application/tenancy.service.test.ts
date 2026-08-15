import { createHash, randomUUID } from "node:crypto";
import { getConfig } from "@cadeau/config";
import { beforeEach, describe, expect, it } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { SessionReissuePort } from "../../../shared/contracts/session-reissue.port";
import type { TokenPair } from "../../../shared/contracts/token-pair";
import type { TenancyAuditEvent, TenancyAuditPort } from "../domain/tenancy-audit.port";
import type { TenancyRepositoryPort } from "../domain/tenancy-repository.port";
import { SlugAlreadyTakenError } from "../domain/tenancy.errors";
import type {
  AcceptOutcome,
  AcceptWarehouseJoinCodeOutcome,
  CompanyRecord,
  InvitationRecord,
  MembershipCompany,
  MemberView,
  MeProfileRow,
  RemoveMemberOutcome,
} from "../domain/tenancy.types";
import { VENDOR_ROLE } from "../domain/tenancy-roles";
import { TenancyService } from "./tenancy.service";

const config = getConfig();
const hash = (code: string): string => createHash("sha256").update(code).digest("hex");

interface Member {
  id: string;
  companyId: string;
  userId: string;
  role: string;
  status: string;
  createdAt: Date;
  warehouseId: string | null;
}

interface JoinCode {
  companyId: string;
  warehouseId: string;
  codeHash: string;
  isActive: boolean;
}
interface Invite {
  id: string;
  companyId: string;
  email: string;
  role: string;
  customPermissionKeys: string[];
  codeHash: string;
  status: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

/** In-memory {@link TenancyRepositoryPort} mirroring the RLS-scoped behaviour. */
class FakeTenancyRepo implements TenancyRepositoryPort {
  readonly profiles = new Map<string, MeProfileRow>();
  readonly companies = new Map<string, CompanyRecord>();
  readonly members: Member[] = [];
  readonly invites = new Map<string, Invite>();
  /** Warehouse join codes (Vendor Accounts, Phase 1), keyed by warehouseId. */
  readonly joinCodes = new Map<string, JoinCode>();
  /** Permission keys the fake company's plan/features make available (test-configurable). */
  availablePermissionKeys: string[] = [
    "access.read",
    "access.manage",
    "orders.read",
    "orders.manage",
    "customers.read",
    "customers.manage",
  ];

  findProfile(userId: string): Promise<MeProfileRow | null> {
    return Promise.resolve(this.profiles.get(userId) ?? null);
  }

  listUserCompanies(userId: string): Promise<MembershipCompany[]> {
    const list = this.members
      .filter((m) => m.userId === userId)
      .map((m) => {
        const c = this.companies.get(m.companyId);
        return {
          id: m.companyId,
          name: c?.name ?? "",
          slug: c?.slug ?? null,
          role: m.role,
          status: m.status,
          whatsappCountryCode: c?.whatsappCountryCode ?? null,
        };
      });
    return Promise.resolve(list);
  }

  readonly trialEndsAtCalls: Date[] = [];

  createCompanyWithOwner(input: {
    companyId: string;
    name: string;
    slug: string | null;
    userId: string;
    phone: string;
    monthlyOrdersRange: string;
    country: string | null;
    facebookHandle: string | null;
    instagramHandle: string | null;
    websiteUrl: string | null;
    shippingCarrier: string | null;
    trialEndsAt: Date;
  }): Promise<CompanyRecord> {
    this.trialEndsAtCalls.push(input.trialEndsAt);
    if (input.slug !== null && [...this.companies.values()].some((c) => c.slug === input.slug)) {
      return Promise.reject(new SlugAlreadyTakenError());
    }
    const company: CompanyRecord = {
      id: input.companyId,
      name: input.name,
      slug: input.slug,
      status: "active",
      phone: input.phone,
      monthlyOrdersRange: input.monthlyOrdersRange,
      country: input.country,
      facebookHandle: input.facebookHandle,
      instagramHandle: input.instagramHandle,
      websiteUrl: input.websiteUrl,
      shippingCarrier: input.shippingCarrier,
      whatsappCountryCode: null,
      createdAt: new Date(),
    };
    this.companies.set(company.id, company);
    this.members.push({
      id: randomUUID(),
      companyId: input.companyId,
      userId: input.userId,
      role: "owner",
      status: "active",
      createdAt: new Date(),
      warehouseId: null,
    });
    return Promise.resolve(company);
  }

  findActiveMembership(userId: string, companyId: string): Promise<{ role: string } | null> {
    const m = this.members.find(
      (x) => x.userId === userId && x.companyId === companyId && x.status === "active",
    );
    return Promise.resolve(m === undefined ? null : { role: m.role });
  }

  updateWhatsappCountryCode(
    companyId: string,
    _actorId: string,
    countryCode: string | null,
  ): Promise<CompanyRecord | null> {
    const company = this.companies.get(companyId);
    if (company === undefined) return Promise.resolve(null);
    const updated: CompanyRecord = { ...company, whatsappCountryCode: countryCode };
    this.companies.set(companyId, updated);
    return Promise.resolve(updated);
  }

  createInvitation(input: {
    companyId: string;
    email: string;
    role: string;
    customPermissionKeys?: readonly string[];
    codeHash: string;
    expiresAt: Date;
    actorId: string;
  }): Promise<InvitationRecord> {
    const invite: Invite = {
      id: randomUUID(),
      companyId: input.companyId,
      email: input.email,
      role: input.role,
      customPermissionKeys: [...(input.customPermissionKeys ?? [])],
      codeHash: input.codeHash,
      status: "pending",
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.invites.set(invite.id, invite);
    return Promise.resolve(toInvitationRecord(invite));
  }

  revokeInvitation(input: {
    companyId: string;
    invitationId: string;
    actorId: string;
  }): Promise<boolean> {
    const invite = this.invites.get(input.invitationId);
    if (
      invite === undefined ||
      invite.companyId !== input.companyId ||
      invite.status !== "pending"
    ) {
      return Promise.resolve(false);
    }
    invite.status = "revoked";
    invite.revokedAt = new Date();
    return Promise.resolve(true);
  }

  listInvitations(companyId: string): Promise<InvitationRecord[]> {
    const list = [...this.invites.values()]
      .filter((i) => i.companyId === companyId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(toInvitationRecord);
    return Promise.resolve(list);
  }

  listCompanyAvailablePermissionKeys(_companyId: string): Promise<string[]> {
    return Promise.resolve([...this.availablePermissionKeys]);
  }

  listMembers(companyId: string): Promise<MemberView[]> {
    const list = this.members
      .filter((m) => m.companyId === companyId && m.status === "active")
      .map(
        (m): MemberView => ({
          id: m.id,
          userId: m.userId,
          name: this.profiles.get(m.userId)?.fullName ?? null,
          email: this.profiles.get(m.userId)?.email ?? "",
          role: m.role,
          status: m.status,
          joinedAt: m.createdAt,
        }),
      );
    return Promise.resolve(list);
  }

  removeMember(input: {
    companyId: string;
    memberId: string;
    actorId: string;
  }): Promise<RemoveMemberOutcome> {
    const index = this.members.findIndex(
      (m) => m.companyId === input.companyId && m.id === input.memberId && m.status === "active",
    );
    if (index === -1) {
      return Promise.resolve({ kind: "not_found" });
    }
    const member = this.members[index] as Member;
    if (member.role === "owner") {
      const ownerCount = this.members.filter(
        (m) => m.companyId === input.companyId && m.role === "owner" && m.status === "active",
      ).length;
      if (ownerCount <= 1) {
        return Promise.resolve({ kind: "last_owner" });
      }
    }
    this.members.splice(index, 1);
    return Promise.resolve({ kind: "removed" });
  }

  acceptInvitationByCode(input: {
    codeHash: string;
    userId: string;
    email: string;
  }): Promise<AcceptOutcome> {
    const invite = [...this.invites.values()].find((i) => i.codeHash === input.codeHash);
    if (
      invite === undefined ||
      invite.status !== "pending" ||
      invite.revokedAt !== null ||
      invite.expiresAt.getTime() <= Date.now()
    ) {
      return Promise.resolve({ kind: "invalid" });
    }
    if (invite.email.toLowerCase() !== input.email.toLowerCase()) {
      return Promise.resolve({ kind: "email_mismatch" });
    }
    const existing = this.members.find(
      (m) => m.companyId === invite.companyId && m.userId === input.userId,
    );
    if (existing !== undefined) {
      return Promise.resolve({
        kind: "already_member",
        companyId: invite.companyId,
        role: existing.role,
      });
    }
    this.members.push({
      id: randomUUID(),
      companyId: invite.companyId,
      userId: input.userId,
      role: invite.role,
      status: "active",
      createdAt: new Date(),
      warehouseId: null,
    });
    invite.status = "accepted";
    return Promise.resolve({ kind: "accepted", companyId: invite.companyId, role: invite.role });
  }

  acceptWarehouseJoinCodeByCode(input: {
    codeHash: string;
    userId: string;
  }): Promise<AcceptWarehouseJoinCodeOutcome> {
    const code = [...this.joinCodes.values()].find(
      (c) => c.codeHash === input.codeHash && c.isActive,
    );
    if (code === undefined) {
      return Promise.resolve({ kind: "invalid" });
    }
    const existing = this.members.find(
      (m) => m.companyId === code.companyId && m.userId === input.userId,
    );
    if (existing !== undefined) {
      return Promise.resolve({
        kind: "already_member",
        companyId: code.companyId,
        role: existing.role,
        warehouseId: existing.warehouseId,
      });
    }
    this.members.push({
      id: randomUUID(),
      companyId: code.companyId,
      userId: input.userId,
      role: VENDOR_ROLE,
      status: "active",
      createdAt: new Date(),
      warehouseId: code.warehouseId,
    });
    return Promise.resolve({
      kind: "accepted",
      companyId: code.companyId,
      role: VENDOR_ROLE,
      warehouseId: code.warehouseId,
    });
  }
}

function toInvitationRecord(i: Invite): InvitationRecord {
  return {
    id: i.id,
    companyId: i.companyId,
    email: i.email,
    role: i.role,
    customPermissionKeys: i.customPermissionKeys,
    status: i.status,
    expiresAt: i.expiresAt,
    createdAt: i.createdAt,
  };
}

class RecordingAudit implements TenancyAuditPort {
  readonly events: TenancyAuditEvent[] = [];
  record(event: TenancyAuditEvent): void {
    this.events.push(event);
  }
}

const TOKENS: TokenPair = { accessToken: "a", refreshToken: "r", expiresInSeconds: 300 };

// Use wall-clock time so invite expiry (now + 7 days) sits in the future
// relative to the in-memory repo's Date.now() liveness checks.
let now = Date.now();
function build() {
  const repo = new FakeTenancyRepo();
  const audit = new RecordingAudit();
  const clock = { now: () => now };
  const reissued: string[] = [];
  const sessions: SessionReissuePort = {
    reissueForCompany: (_principal: RequestPrincipal, companyId: string) => {
      reissued.push(companyId);
      return Promise.resolve(TOKENS);
    },
  };
  const service = new TenancyService(repo, audit, config, clock, sessions);
  return { service, repo, audit, reissued };
}

beforeEach(() => {
  now = Date.now();
});

function seedOwner(repo: FakeTenancyRepo, email: string): { userId: string; companyId: string } {
  const userId = randomUUID();
  const companyId = randomUUID();
  repo.profiles.set(userId, {
    id: userId,
    email,
    fullName: null,
    phoneEncrypted: null,
    totpEnabledAt: null,
  });
  repo.companies.set(companyId, {
    id: companyId,
    name: "Acme",
    slug: "acme",
    status: "active",
    phone: "+201234567890",
    monthlyOrdersRange: "100_500",
    country: null,
    facebookHandle: null,
    instagramHandle: null,
    websiteUrl: null,
    shippingCarrier: null,
    whatsappCountryCode: null,
    createdAt: new Date(),
  });
  repo.members.push({
    id: randomUUID(),
    companyId,
    userId,
    role: "owner",
    status: "active",
    createdAt: new Date(),
    warehouseId: null,
  });
  return { userId, companyId };
}

/** Seed an active warehouse join code in the fake repo (Vendor Accounts, Phase 1). */
function seedJoinCode(repo: FakeTenancyRepo, companyId: string, warehouseId: string): string {
  const code = randomUUID();
  repo.joinCodes.set(warehouseId, {
    companyId,
    warehouseId,
    codeHash: hash(code),
    isActive: true,
  });
  return code;
}

describe("getMe", () => {
  it("returns the profile and the caller's companies", async () => {
    const { service, repo } = build();
    const { userId, companyId } = seedOwner(repo, "me@test.dev");
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId };
    const me = await service.getMe(principal);
    expect(me.email).toBe("me@test.dev");
    expect(me.twoFactorEnabled).toBe(false);
    expect(me.activeCompanyId).toBe(companyId);
    expect(me.companies).toHaveLength(1);
  });
});

const ONBOARDING_FIELDS = {
  phone: "+201234567890",
  monthlyOrdersRange: "100_500",
  country: "Egypt",
  facebookHandle: "facebook.com/acme",
  instagramHandle: "@acme",
  websiteUrl: "https://acme.test",
  shippingCarrier: "Aramex",
} as const;

describe("createCompany", () => {
  it("creates the company, makes the caller owner, and re-issues tokens", async () => {
    const { service, repo, audit, reissued } = build();
    const userId = randomUUID();
    repo.profiles.set(userId, {
      id: userId,
      email: "founder@test.dev",
      fullName: null,
      phoneEncrypted: null,
      totpEnabledAt: null,
    });
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId: null };
    const result = await service.createCompany(principal, {
      name: "New Co",
      slug: "new-co",
      ...ONBOARDING_FIELDS,
    });
    expect(result.company.name).toBe("New Co");
    expect(result.company.phone).toBe(ONBOARDING_FIELDS.phone);
    expect(result.company.monthlyOrdersRange).toBe(ONBOARDING_FIELDS.monthlyOrdersRange);
    // Free trial: every new company gets a 30-day trial window from "now".
    expect(repo.trialEndsAtCalls).toHaveLength(1);
    expect(repo.trialEndsAtCalls[0]?.getTime()).toBe(now + 30 * 24 * 60 * 60 * 1000);
    expect(result.company.country).toBe(ONBOARDING_FIELDS.country);
    expect(result.tokens).toEqual(TOKENS);
    expect(reissued).toContain(result.company.id);
    expect(audit.events).toContain("company.created");
  });

  it("409s on a duplicate slug", async () => {
    const { service, repo } = build();
    const { userId } = seedOwner(repo, "dup@test.dev"); // seeds slug "acme"
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId: null };
    await expect(
      service.createCompany(principal, { name: "X", slug: "acme", ...ONBOARDING_FIELDS }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("switchCompany", () => {
  it("re-issues tokens for a company the caller is an active member of", async () => {
    const { service, repo, reissued } = build();
    const { userId, companyId } = seedOwner(repo, "sw@test.dev");
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId: null };
    const tokens = await service.switchCompany(principal, companyId);
    expect(tokens).toEqual(TOKENS);
    expect(reissued).toContain(companyId);
  });

  it("403s when the caller is not a member", async () => {
    const { service, repo } = build();
    const { userId } = seedOwner(repo, "sw2@test.dev");
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId: null };
    await expect(service.switchCompany(principal, randomUUID())).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe("updateWhatsappSettings", () => {
  it("updates the prefix and records an audit event", async () => {
    const { service, repo, audit } = build();
    const { userId, companyId } = seedOwner(repo, "wa@test.dev");
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId };

    const updated = await service.updateWhatsappSettings(principal, companyId, "20");

    expect(updated.whatsappCountryCode).toBe("20");
    expect(repo.companies.get(companyId)?.whatsappCountryCode).toBe("20");
    expect(audit.events).toContain("company.whatsapp_settings_updated");
  });

  it("clears the prefix when passed null", async () => {
    const { service, repo } = build();
    const { userId, companyId } = seedOwner(repo, "wa2@test.dev");
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId };

    await service.updateWhatsappSettings(principal, companyId, "20");
    await service.updateWhatsappSettings(principal, companyId, null);

    expect(repo.companies.get(companyId)?.whatsappCountryCode).toBeNull();
  });

  it("403s when the caller is not an active member of that company", async () => {
    const { service, repo } = build();
    const { userId } = seedOwner(repo, "wa3@test.dev");
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId: null };
    await expect(
      service.updateWhatsappSettings(principal, randomUUID(), "20"),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("invitations", () => {
  it("creates, then accepts an invite (invitee joins the company)", async () => {
    const { service, repo, audit } = build();
    const { userId: ownerId, companyId } = seedOwner(repo, "owner@test.dev");
    const owner: RequestPrincipal = { userId: ownerId, sessionId: randomUUID(), companyId };

    const created = await service.createInvitation(owner, companyId, {
      email: "invitee@test.dev",
      role: "member",
    });
    expect(created.code).toBeTruthy();
    expect(audit.events).toContain("member.invited");

    const inviteeId = randomUUID();
    repo.profiles.set(inviteeId, {
      id: inviteeId,
      email: "invitee@test.dev",
      fullName: null,
      phoneEncrypted: null,
      totpEnabledAt: null,
    });
    const invitee: RequestPrincipal = {
      userId: inviteeId,
      sessionId: randomUUID(),
      companyId: null,
    };
    const accepted = await service.acceptInvitation(invitee, created.code);
    expect(accepted).toMatchObject({ companyId, role: "member", alreadyMember: false });
    expect(audit.events).toContain("member.joined");
  });

  it("403s creating an invite for a non-active tenant", async () => {
    const { service, repo } = build();
    const { userId, companyId } = seedOwner(repo, "owner2@test.dev");
    // Active tenant in the token differs from the path company.
    const principal: RequestPrincipal = {
      userId,
      sessionId: randomUUID(),
      companyId: randomUUID(),
    };
    await expect(
      service.createInvitation(principal, companyId, { email: "x@test.dev", role: "member" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects an invite for a different email with 403", async () => {
    const { service, repo } = build();
    const { userId: ownerId, companyId } = seedOwner(repo, "owner3@test.dev");
    const owner: RequestPrincipal = { userId: ownerId, sessionId: randomUUID(), companyId };
    const created = await service.createInvitation(owner, companyId, {
      email: "intended@test.dev",
      role: "member",
    });

    const otherId = randomUUID();
    repo.profiles.set(otherId, {
      id: otherId,
      email: "someone-else@test.dev",
      fullName: null,
      phoneEncrypted: null,
      totpEnabledAt: null,
    });
    const other: RequestPrincipal = { userId: otherId, sessionId: randomUUID(), companyId: null };
    await expect(service.acceptInvitation(other, created.code)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("404s an unknown or revoked invite code", async () => {
    const { service, repo } = build();
    const { userId } = seedOwner(repo, "owner4@test.dev");
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId: null };
    await expect(service.acceptInvitation(principal, "nonexistent-code")).rejects.toMatchObject({
      status: 404,
    });
    expect(hash("nonexistent-code")).toHaveLength(64); // sanity: codes are hashed
  });

  it("revokes a pending invite, and 404s a second revoke", async () => {
    const { service, repo } = build();
    const { userId, companyId } = seedOwner(repo, "owner5@test.dev");
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId };
    const created = await service.createInvitation(principal, companyId, {
      email: "gone@test.dev",
      role: "member",
    });
    const inviteId = [...repo.invites.values()][0]?.id as string;
    await service.revokeInvitation(principal, companyId, inviteId);
    await expect(service.revokeInvitation(principal, companyId, inviteId)).rejects.toMatchObject({
      status: 404,
    });
    // A revoked invite can no longer be accepted.
    const inviteeId = randomUUID();
    repo.profiles.set(inviteeId, {
      id: inviteeId,
      email: "gone@test.dev",
      fullName: null,
      phoneEncrypted: null,
      totpEnabledAt: null,
    });
    const invitee: RequestPrincipal = {
      userId: inviteeId,
      sessionId: randomUUID(),
      companyId: null,
    };
    await expect(service.acceptInvitation(invitee, created.code)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("404s an expired invite code", async () => {
    const { service, repo } = build();
    const { userId, companyId } = seedOwner(repo, "owner6@test.dev");
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId };
    // Back-date the clock so the 7-day TTL computed from it already sits in the
    // past relative to the fake repo's real-wall-clock expiry check.
    now = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const created = await service.createInvitation(principal, companyId, {
      email: "late@test.dev",
      role: "member",
    });
    now = Date.now();
    const inviteeId = randomUUID();
    repo.profiles.set(inviteeId, {
      id: inviteeId,
      email: "late@test.dev",
      fullName: null,
      phoneEncrypted: null,
      totpEnabledAt: null,
    });
    const invitee: RequestPrincipal = {
      userId: inviteeId,
      sessionId: randomUUID(),
      companyId: null,
    };
    await expect(service.acceptInvitation(invitee, created.code)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("404s reusing an already-accepted invitation code (single-use)", async () => {
    const { service, repo } = build();
    const { userId: ownerId, companyId } = seedOwner(repo, "owner7@test.dev");
    const owner: RequestPrincipal = { userId: ownerId, sessionId: randomUUID(), companyId };
    const created = await service.createInvitation(owner, companyId, {
      email: "reuse@test.dev",
      role: "member",
    });
    const inviteeId = randomUUID();
    repo.profiles.set(inviteeId, {
      id: inviteeId,
      email: "reuse@test.dev",
      fullName: null,
      phoneEncrypted: null,
      totpEnabledAt: null,
    });
    const invitee: RequestPrincipal = {
      userId: inviteeId,
      sessionId: randomUUID(),
      companyId: null,
    };
    const first = await service.acceptInvitation(invitee, created.code);
    expect(first.alreadyMember).toBe(false);
    // The code was single-use: a second accept (even by the same invitee) 404s
    // rather than silently re-joining, because the invitation is no longer pending.
    await expect(service.acceptInvitation(invitee, created.code)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("createInvitation — predefined template roles", () => {
  it("accepts a fixed template role with no permissionKeys", async () => {
    const { service, repo, audit } = build();
    const { userId, companyId } = seedOwner(repo, "tpl1@test.dev");
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId };
    const created = await service.createInvitation(principal, companyId, {
      email: "sm@test.dev",
      role: "store_manager",
    });
    expect(created.invitation.role).toBe("store_manager");
    expect(created.invitation.customPermissionKeys).toEqual([]);
    expect(audit.events).toContain("member.invited");
  });

  it("rejects permissionKeys sent alongside a non-custom role", async () => {
    const { service, repo } = build();
    const { userId, companyId } = seedOwner(repo, "tpl2@test.dev");
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId };
    await expect(
      service.createInvitation(principal, companyId, {
        email: "sm2@test.dev",
        role: "store_manager",
        permissionKeys: ["orders.read"],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("createInvitation — inviting an Owner", () => {
  it("403s: a non-Owner member cannot invite an Owner, even one with access.manage-shaped capabilities", async () => {
    const { service, repo } = build();
    const { companyId } = seedOwner(repo, "ownerinv1@test.dev");
    // A second, non-Owner member — the caller for this test.
    const managerId = randomUUID();
    repo.profiles.set(managerId, {
      id: managerId,
      email: "manager@test.dev",
      fullName: null,
      phoneEncrypted: null,
      totpEnabledAt: null,
    });
    repo.members.push({
      id: randomUUID(),
      companyId,
      userId: managerId,
      role: "store_manager",
      status: "active",
      createdAt: new Date(),
      warehouseId: null,
    });
    const manager: RequestPrincipal = { userId: managerId, sessionId: randomUUID(), companyId };
    await expect(
      service.createInvitation(manager, companyId, { email: "newowner@test.dev", role: "owner" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("allows an existing Owner to invite another Owner", async () => {
    const { service, repo, audit } = build();
    const { userId: ownerId, companyId } = seedOwner(repo, "ownerinv2@test.dev");
    const owner: RequestPrincipal = { userId: ownerId, sessionId: randomUUID(), companyId };
    const created = await service.createInvitation(owner, companyId, {
      email: "newowner2@test.dev",
      role: "owner",
    });
    expect(created.invitation.role).toBe("owner");
    expect(audit.events).toContain("member.invited");
  });
});

describe("createInvitation — custom role", () => {
  it("creates a custom-role invitation with exactly the chosen (available) permissions", async () => {
    const { service, repo, audit } = build();
    const { userId, companyId } = seedOwner(repo, "custom1@test.dev");
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId };
    const created = await service.createInvitation(principal, companyId, {
      email: "c1@test.dev",
      role: "custom",
      permissionKeys: ["orders.read", "orders.read", "customers.read"], // dupes collapse
    });
    expect(created.invitation.role).toBe("custom");
    expect(created.invitation.customPermissionKeys).toEqual(["orders.read", "customers.read"]);
    expect(audit.events).toContain("member.invited");
  });

  it("400s a custom role with no permissionKeys", async () => {
    const { service, repo } = build();
    const { userId, companyId } = seedOwner(repo, "custom2@test.dev");
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId };
    await expect(
      service.createInvitation(principal, companyId, { email: "c2@test.dev", role: "custom" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.createInvitation(principal, companyId, {
        email: "c2@test.dev",
        role: "custom",
        permissionKeys: [],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400s a custom role with a permission the company's plan doesn't make available", async () => {
    const { service, repo } = build();
    const { userId, companyId } = seedOwner(repo, "custom3@test.dev");
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId };
    // The company's available set (test fixture) does not include "finance.manage".
    await expect(
      service.createInvitation(principal, companyId, {
        email: "c3@test.dev",
        role: "custom",
        permissionKeys: ["orders.read", "finance.manage"],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400s a custom role with an unknown/garbage permission key", async () => {
    const { service, repo } = build();
    const { userId, companyId } = seedOwner(repo, "custom4@test.dev");
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId };
    await expect(
      service.createInvitation(principal, companyId, {
        email: "c4@test.dev",
        role: "custom",
        permissionKeys: ["not-a-real-permission"],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("never trusts the caller's payload: an available-looking key not on this company's plan is still rejected", async () => {
    const { service, repo } = build();
    repo.availablePermissionKeys = ["orders.read"]; // this company's plan only allows orders.read
    const { userId, companyId } = seedOwner(repo, "custom5@test.dev");
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId };
    await expect(
      service.createInvitation(principal, companyId, {
        email: "c5@test.dev",
        role: "custom",
        permissionKeys: ["orders.read", "orders.manage"],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("acceptInvitation — custom role", () => {
  it("grants exactly the selected permissions on acceptance (no template inheritance)", async () => {
    const { service, repo } = build();
    const { userId: ownerId, companyId } = seedOwner(repo, "acc1@test.dev");
    const owner: RequestPrincipal = { userId: ownerId, sessionId: randomUUID(), companyId };
    const created = await service.createInvitation(owner, companyId, {
      email: "invitee@test.dev",
      role: "custom",
      permissionKeys: ["orders.read", "customers.manage"],
    });

    const inviteeId = randomUUID();
    repo.profiles.set(inviteeId, {
      id: inviteeId,
      email: "invitee@test.dev",
      fullName: null,
      phoneEncrypted: null,
      totpEnabledAt: null,
    });
    const invitee: RequestPrincipal = {
      userId: inviteeId,
      sessionId: randomUUID(),
      companyId: null,
    };
    const accepted = await service.acceptInvitation(invitee, created.code);
    expect(accepted).toMatchObject({ companyId, role: "custom", alreadyMember: false });

    const member = repo.members.find((m) => m.userId === inviteeId);
    expect(member?.role).toBe("custom");
  });
});

describe("listMembers / removeMember", () => {
  it("lists only active members", async () => {
    const { service, repo } = build();
    const { userId, companyId } = seedOwner(repo, "lm1@test.dev");
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId };
    const members = await service.listMembers(principal, companyId);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ role: "owner", status: "active" });
  });

  it("removes a non-owner member", async () => {
    const { service, repo, audit } = build();
    const { userId: ownerId, companyId } = seedOwner(repo, "rm1@test.dev");
    const owner: RequestPrincipal = { userId: ownerId, sessionId: randomUUID(), companyId };
    const otherId = randomUUID();
    const otherMemberId = randomUUID();
    repo.profiles.set(otherId, {
      id: otherId,
      email: "other@test.dev",
      fullName: "Other",
      phoneEncrypted: null,
      totpEnabledAt: null,
    });
    repo.members.push({
      id: otherMemberId,
      companyId,
      userId: otherId,
      role: "member",
      status: "active",
      createdAt: new Date(),
      warehouseId: null,
    });

    await service.removeMember(owner, companyId, otherMemberId);

    expect(repo.members.some((m) => m.id === otherMemberId)).toBe(false);
    expect(audit.events).toContain("member.removed");
  });

  it("404s removing an unknown member", async () => {
    const { service, repo } = build();
    const { userId, companyId } = seedOwner(repo, "rm2@test.dev");
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId };
    await expect(service.removeMember(principal, companyId, randomUUID())).rejects.toMatchObject({
      status: 404,
    });
  });

  it("409s removing the company's last owner", async () => {
    const { service, repo } = build();
    const { userId, companyId } = seedOwner(repo, "rm3@test.dev");
    const principal: RequestPrincipal = { userId, sessionId: randomUUID(), companyId };
    const ownerMember = repo.members.find((m) => m.userId === userId && m.companyId === companyId);
    await expect(
      service.removeMember(principal, companyId, ownerMember?.id as string),
    ).rejects.toMatchObject({ status: 409 });
    // The owner is still there — nothing was removed.
    expect(repo.members.some((m) => m.id === ownerMember?.id)).toBe(true);
  });

  it("allows removing an owner when another active owner remains", async () => {
    const { service, repo } = build();
    const { userId: owner1Id, companyId } = seedOwner(repo, "rm4@test.dev");
    const owner1: RequestPrincipal = { userId: owner1Id, sessionId: randomUUID(), companyId };
    const owner2Id = randomUUID();
    const owner2MemberId = randomUUID();
    repo.profiles.set(owner2Id, {
      id: owner2Id,
      email: "owner2@test.dev",
      fullName: null,
      phoneEncrypted: null,
      totpEnabledAt: null,
    });
    repo.members.push({
      id: owner2MemberId,
      companyId,
      userId: owner2Id,
      role: "owner",
      status: "active",
      createdAt: new Date(),
      warehouseId: null,
    });

    await service.removeMember(owner1, companyId, owner2MemberId);
    expect(repo.members.some((m) => m.id === owner2MemberId)).toBe(false);
  });
});

describe("joinWarehouseByCode (Vendor Accounts, Phase 1)", () => {
  it("joins as a vendor scoped to the code's warehouse", async () => {
    const { service, repo, audit } = build();
    const { companyId } = seedOwner(repo, "owner@test.dev");
    const warehouseId = randomUUID();
    const code = seedJoinCode(repo, companyId, warehouseId);

    const vendorId = randomUUID();
    repo.profiles.set(vendorId, {
      id: vendorId,
      email: "vendor@test.dev",
      fullName: null,
      phoneEncrypted: null,
      totpEnabledAt: null,
    });
    const principal: RequestPrincipal = {
      userId: vendorId,
      sessionId: randomUUID(),
      companyId: null,
    };

    const result = await service.joinWarehouseByCode(principal, code);

    expect(result).toEqual({
      companyId,
      role: "vendor",
      warehouseId,
      alreadyMember: false,
    });
    const member = repo.members.find((m) => m.userId === vendorId);
    expect(member?.role).toBe("vendor");
    expect(member?.warehouseId).toBe(warehouseId);
    expect(audit.events).toContain("member.joined_via_warehouse_code");
  });

  it("404s an unknown code (no enumeration)", async () => {
    const { service, repo } = build();
    const vendorId = randomUUID();
    repo.profiles.set(vendorId, {
      id: vendorId,
      email: "vendor2@test.dev",
      fullName: null,
      phoneEncrypted: null,
      totpEnabledAt: null,
    });
    const principal: RequestPrincipal = {
      userId: vendorId,
      sessionId: randomUUID(),
      companyId: null,
    };
    await expect(service.joinWarehouseByCode(principal, "nonexistent-code")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("404s a revoked code", async () => {
    const { service, repo } = build();
    const { companyId } = seedOwner(repo, "owner3@test.dev");
    const warehouseId = randomUUID();
    const code = seedJoinCode(repo, companyId, warehouseId);
    const joinCode = repo.joinCodes.get(warehouseId);
    if (joinCode !== undefined) joinCode.isActive = false;

    const vendorId = randomUUID();
    repo.profiles.set(vendorId, {
      id: vendorId,
      email: "vendor3@test.dev",
      fullName: null,
      phoneEncrypted: null,
      totpEnabledAt: null,
    });
    const principal: RequestPrincipal = {
      userId: vendorId,
      sessionId: randomUUID(),
      companyId: null,
    };
    await expect(service.joinWarehouseByCode(principal, code)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("is idempotent for an already-joined vendor", async () => {
    const { service, repo } = build();
    const { companyId } = seedOwner(repo, "owner4@test.dev");
    const warehouseId = randomUUID();
    const code = seedJoinCode(repo, companyId, warehouseId);

    const vendorId = randomUUID();
    repo.profiles.set(vendorId, {
      id: vendorId,
      email: "vendor4@test.dev",
      fullName: null,
      phoneEncrypted: null,
      totpEnabledAt: null,
    });
    const principal: RequestPrincipal = {
      userId: vendorId,
      sessionId: randomUUID(),
      companyId: null,
    };

    const first = await service.joinWarehouseByCode(principal, code);
    expect(first.alreadyMember).toBe(false);
    const second = await service.joinWarehouseByCode(principal, code);
    expect(second).toEqual({ companyId, role: "vendor", warehouseId, alreadyMember: true });
    // Only one membership row was created — the second call did not duplicate it.
    expect(repo.members.filter((m) => m.userId === vendorId)).toHaveLength(1);
  });

  it("a code from company A never resolves into company B", async () => {
    const { service, repo } = build();
    const { companyId: companyA } = seedOwner(repo, "ownerA@test.dev");
    const { companyId: companyB } = seedOwner(repo, "ownerB@test.dev");
    const warehouseId = randomUUID();
    const code = seedJoinCode(repo, companyA, warehouseId);

    const vendorId = randomUUID();
    repo.profiles.set(vendorId, {
      id: vendorId,
      email: "vendor5@test.dev",
      fullName: null,
      phoneEncrypted: null,
      totpEnabledAt: null,
    });
    const principal: RequestPrincipal = {
      userId: vendorId,
      sessionId: randomUUID(),
      companyId: null,
    };

    const result = await service.joinWarehouseByCode(principal, code);
    expect(result.companyId).toBe(companyA);
    expect(result.companyId).not.toBe(companyB);
  });
});
