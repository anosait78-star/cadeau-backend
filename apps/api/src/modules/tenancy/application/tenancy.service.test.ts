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
  CompanyRecord,
  InvitationRecord,
  MembershipCompany,
  MeProfileRow,
} from "../domain/tenancy.types";
import { TenancyService } from "./tenancy.service";

const config = getConfig();
const hash = (code: string): string => createHash("sha256").update(code).digest("hex");

interface Member {
  companyId: string;
  userId: string;
  role: string;
  status: string;
  createdAt: Date;
}
interface Invite {
  id: string;
  companyId: string;
  email: string;
  role: string;
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
      companyId: input.companyId,
      userId: input.userId,
      role: "owner",
      status: "active",
      createdAt: new Date(),
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
    codeHash: string;
    expiresAt: Date;
    actorId: string;
  }): Promise<InvitationRecord> {
    const invite: Invite = {
      id: randomUUID(),
      companyId: input.companyId,
      email: input.email,
      role: input.role,
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
      companyId: invite.companyId,
      userId: input.userId,
      role: invite.role,
      status: "active",
      createdAt: new Date(),
    });
    invite.status = "accepted";
    return Promise.resolve({ kind: "accepted", companyId: invite.companyId, role: invite.role });
  }
}

function toInvitationRecord(i: Invite): InvitationRecord {
  return {
    id: i.id,
    companyId: i.companyId,
    email: i.email,
    role: i.role,
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
  repo.members.push({ companyId, userId, role: "owner", status: "active", createdAt: new Date() });
  return { userId, companyId };
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
});
