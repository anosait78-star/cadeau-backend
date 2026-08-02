import { randomUUID } from "node:crypto";
import { getConfig } from "@cadeau/config";
import { beforeEach, describe, expect, it } from "vitest";
import type { AuthAuditEvent, AuthAuditPort } from "../domain/auth-audit.port";
import type { AuthRepositoryPort } from "../domain/auth-repository.port";
import { EmailAlreadyExistsError } from "../domain/auth.errors";
import type {
  NewProfile,
  NewSession,
  ProfileRecord,
  RequestMeta,
  SessionRecord,
} from "../domain/auth.types";
import { AuthService } from "./auth.service";
import { TokenService } from "./token.service";

const config = getConfig();
const META: RequestMeta = { userAgent: "vitest", ipAddress: "127.0.0.1" };

/** In-memory {@link AuthRepositoryPort} for fast, DB-free service tests. */
class FakeRepo implements AuthRepositoryPort {
  readonly profiles = new Map<string, ProfileRecord>();
  readonly sessions = new Map<string, SessionRecord>();
  private seq = 0;

  findProfileByEmail(email: string): Promise<ProfileRecord | null> {
    for (const p of this.profiles.values()) if (p.email === email) return Promise.resolve(p);
    return Promise.resolve(null);
  }

  createProfile(input: NewProfile): Promise<ProfileRecord> {
    for (const p of this.profiles.values()) {
      if (p.email === input.email) return Promise.reject(new EmailAlreadyExistsError());
    }
    const record: ProfileRecord = {
      id: `p-${++this.seq}`,
      email: input.email,
      passwordHash: input.passwordHash,
      fullName: input.fullName,
      phoneEncrypted: input.phoneEncrypted,
      totpSecretEncrypted: null,
      totpEnabledAt: null,
      deletionRequestedAt: null,
      createdAt: new Date(),
    };
    this.profiles.set(record.id, record);
    return Promise.resolve(record);
  }

  createSession(input: NewSession): Promise<SessionRecord> {
    const record: SessionRecord = {
      id: input.id,
      userId: input.userId,
      companyId: input.companyId,
      familyId: input.familyId,
      refreshTokenHash: input.refreshTokenHash,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.sessions.set(record.id, record);
    return Promise.resolve(record);
  }

  findSessionByRefreshHash(hash: string): Promise<SessionRecord | null> {
    for (const s of this.sessions.values()) {
      if (s.refreshTokenHash === hash) return Promise.resolve(s);
    }
    return Promise.resolve(null);
  }

  rotateSession(input: {
    sessionId: string;
    expectedHash: string;
    newRefreshTokenHash: string;
    newExpiresAt: Date;
  }): Promise<SessionRecord | null> {
    const s = this.sessions.get(input.sessionId);
    if (s === undefined || s.revokedAt !== null || s.refreshTokenHash !== input.expectedHash) {
      return Promise.resolve(null);
    }
    const updated: SessionRecord = {
      ...s,
      refreshTokenHash: input.newRefreshTokenHash,
      expiresAt: input.newExpiresAt,
    };
    this.sessions.set(s.id, updated);
    return Promise.resolve(updated);
  }

  revokeFamily(familyId: string): Promise<void> {
    for (const [id, s] of this.sessions) {
      if (s.familyId === familyId && s.revokedAt === null) {
        this.sessions.set(id, { ...s, revokedAt: new Date() });
      }
    }
    return Promise.resolve();
  }

  findOwnSessionById(userId: string, sessionId: string): Promise<SessionRecord | null> {
    const s = this.sessions.get(sessionId);
    return Promise.resolve(s !== undefined && s.userId === userId ? s : null);
  }

  revokeOwnSession(userId: string, sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s !== undefined && s.userId === userId && s.revokedAt === null) {
      this.sessions.set(sessionId, { ...s, revokedAt: new Date() });
    }
    return Promise.resolve();
  }

  listOwnSessions(userId: string): Promise<SessionRecord[]> {
    return Promise.resolve([...this.sessions.values()].filter((s) => s.userId === userId));
  }

  findOwnProfileById(userId: string): Promise<ProfileRecord | null> {
    return Promise.resolve(this.profiles.get(userId) ?? null);
  }

  setTotpSecret(userId: string, secretEncrypted: string): Promise<void> {
    const p = this.profiles.get(userId);
    if (p !== undefined) {
      this.profiles.set(userId, {
        ...p,
        totpSecretEncrypted: secretEncrypted,
        totpEnabledAt: null,
      });
    }
    return Promise.resolve();
  }

  enableTotp(userId: string, enabledAt: Date): Promise<void> {
    const p = this.profiles.get(userId);
    if (p !== undefined) this.profiles.set(userId, { ...p, totpEnabledAt: enabledAt });
    return Promise.resolve();
  }

  setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    const p = this.profiles.get(userId);
    if (p !== undefined) this.profiles.set(userId, { ...p, passwordHash });
    return Promise.resolve();
  }

  requestAccountDeletion(userId: string, requestedAt: Date): Promise<void> {
    const p = this.profiles.get(userId);
    if (p !== undefined && p.deletionRequestedAt === null) {
      this.profiles.set(userId, { ...p, deletionRequestedAt: requestedAt });
    }
    return Promise.resolve();
  }

  bindSessionCompany(input: {
    sessionId: string;
    userId: string;
    companyId: string;
    newFamilyId: string;
    newRefreshTokenHash: string;
    newExpiresAt: Date;
  }): Promise<SessionRecord | null> {
    const s = this.sessions.get(input.sessionId);
    if (s === undefined || s.userId !== input.userId || s.revokedAt !== null) {
      return Promise.resolve(null);
    }
    const updated: SessionRecord = {
      ...s,
      companyId: input.companyId,
      familyId: input.newFamilyId,
      refreshTokenHash: input.newRefreshTokenHash,
      expiresAt: input.newExpiresAt,
    };
    this.sessions.set(s.id, updated);
    return Promise.resolve(updated);
  }
}

class RecordingAudit implements AuthAuditPort {
  readonly events: AuthAuditEvent[] = [];
  record(event: AuthAuditEvent): void {
    this.events.push(event);
  }
}

let now = 1_700_000_000_000;
function build(): { service: AuthService; repo: FakeRepo; audit: RecordingAudit } {
  const repo = new FakeRepo();
  const audit = new RecordingAudit();
  const clock = { now: () => now };
  const tokens = new TokenService(config, clock);
  const service = new AuthService(repo, audit, config, clock, tokens);
  return { service, repo, audit };
}

beforeEach(() => {
  now = 1_700_000_000_000;
});

describe("register", () => {
  it("creates a profile, opens a session, and returns tokens", async () => {
    const { service, repo, audit } = build();
    const result = await service.register(
      { email: "a@test.dev", password: "password123", fullName: "A", phone: "+20 100 000 0000" },
      META,
    );
    expect(result.user.email).toBe("a@test.dev");
    expect(result.tokens.accessToken).toBeTruthy();
    expect(repo.sessions.size).toBe(1);
    // The phone is stored encrypted, never as plaintext.
    const profile = [...repo.profiles.values()][0];
    expect(profile?.phoneEncrypted).toMatch(/^v1\./);
    expect(audit.events).toContain("auth.registered");
  });

  it("rejects a duplicate email with a conflict", async () => {
    const { service } = build();
    const input = { email: "dup@test.dev", password: "password123", fullName: null, phone: null };
    await service.register(input, META);
    await expect(service.register(input, META)).rejects.toMatchObject({ status: 409 });
  });
});

describe("login", () => {
  it("returns tokens for correct credentials", async () => {
    const { service, audit } = build();
    await service.register(
      { email: "u@test.dev", password: "password123", fullName: null, phone: null },
      META,
    );
    const result = await service.login(
      { email: "u@test.dev", password: "password123", totpCode: null },
      META,
    );
    expect(result.tokens.refreshToken).toBeTruthy();
    expect(audit.events).toContain("auth.logged_in");
  });

  it("rejects a wrong password without revealing which factor failed", async () => {
    const { service, audit } = build();
    await service.register(
      { email: "u@test.dev", password: "password123", fullName: null, phone: null },
      META,
    );
    await expect(
      service.login({ email: "u@test.dev", password: "wrong", totpCode: null }, META),
    ).rejects.toMatchObject({ status: 401 });
    expect(audit.events).toContain("auth.login_failed");
  });

  it("rejects an unknown email with the same error", async () => {
    const { service } = build();
    await expect(
      service.login({ email: "ghost@test.dev", password: "password123", totpCode: null }, META),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("refresh (rotation + reuse detection)", () => {
  it("rotates the token pair and invalidates the old refresh token", async () => {
    const { service } = build();
    const { tokens } = await service.register(
      { email: "r@test.dev", password: "password123", fullName: null, phone: null },
      META,
    );
    now += 1000;
    const rotated = await service.refresh(tokens.refreshToken, META);
    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);

    // Reusing the original (now-rotated) refresh token is rejected...
    await expect(service.refresh(tokens.refreshToken, META)).rejects.toMatchObject({ status: 401 });
    // ...and the reuse burns the whole family, so the rotated token is dead too.
    await expect(service.refresh(rotated.refreshToken, META)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects a refresh token for a revoked session", async () => {
    const { service, repo } = build();
    const { tokens } = await service.register(
      { email: "rv@test.dev", password: "password123", fullName: null, phone: null },
      META,
    );
    for (const [id, s] of repo.sessions) repo.sessions.set(id, { ...s, revokedAt: new Date() });
    await expect(service.refresh(tokens.refreshToken, META)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a garbage refresh token", async () => {
    const { service } = build();
    await expect(service.refresh("not-a-jwt", META)).rejects.toMatchObject({ status: 401 });
  });
});

describe("sessions", () => {
  async function seed() {
    const ctx = build();
    const { tokens } = await ctx.service.register(
      { email: "s@test.dev", password: "password123", fullName: null, phone: null },
      META,
    );
    const session = [...ctx.repo.sessions.values()][0] as SessionRecord;
    const principal = { userId: session.userId, sessionId: session.id, companyId: null };
    return { ...ctx, principal, tokens };
  }

  it("lists the caller's sessions and flags the current one", async () => {
    const { service, principal } = await seed();
    const sessions = await service.listSessions(principal);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.current).toBe(true);
  });

  it("logout revokes the current session", async () => {
    const { service, repo, principal } = await seed();
    await service.logout(principal);
    expect(repo.sessions.get(principal.sessionId)?.revokedAt).not.toBeNull();
  });

  it("revokes a specific owned session", async () => {
    const { service, repo, principal } = await seed();
    await service.revokeSession(principal, principal.sessionId);
    expect(repo.sessions.get(principal.sessionId)?.revokedAt).not.toBeNull();
  });

  it("404s when revoking a session the caller does not own", async () => {
    const { service, principal } = await seed();
    await expect(service.revokeSession(principal, randomUUID())).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("2FA (TOTP)", () => {
  async function seedUser() {
    const ctx = build();
    await ctx.service.register(
      { email: "2fa@test.dev", password: "password123", fullName: null, phone: null },
      META,
    );
    const profile = [...ctx.repo.profiles.values()][0] as ProfileRecord;
    const principal = { userId: profile.id, sessionId: randomUUID(), companyId: null };
    return { ...ctx, principal };
  }

  it("enrolls, then verifies a valid code to enable 2FA", async () => {
    const { service, repo, principal, audit } = await seedUser();
    const enrolment = await service.enrollTotp(principal);
    expect(enrolment.secret).toMatch(/^[A-Z2-7]+$/);
    expect(enrolment.otpauthUri).toContain("otpauth://totp/");

    const { generateTotp } = await import("@cadeau/crypto");
    const code = generateTotp(enrolment.secret, { now });
    await service.verifyTotpEnrolment(principal, code);

    expect(repo.profiles.get(principal.userId)?.totpEnabledAt).not.toBeNull();
    expect(audit.events).toContain("auth.2fa_enabled");
  });

  it("rejects a wrong code during verification", async () => {
    const { service, principal } = await seedUser();
    await service.enrollTotp(principal);
    await expect(service.verifyTotpEnrolment(principal, "000000")).rejects.toMatchObject({
      status: 401,
    });
  });

  it("challenges login once 2FA is enabled and accepts a valid code", async () => {
    const { service, principal } = await seedUser();
    const enrolment = await service.enrollTotp(principal);
    const { generateTotp } = await import("@cadeau/crypto");
    await service.verifyTotpEnrolment(principal, generateTotp(enrolment.secret, { now }));

    // Missing code ⇒ 401 flagged twoFactorRequired.
    await expect(
      service.login({ email: "2fa@test.dev", password: "password123", totpCode: null }, META),
    ).rejects.toMatchObject({ status: 401, response: { details: { twoFactorRequired: true } } });

    // Valid code ⇒ tokens.
    const ok = await service.login(
      {
        email: "2fa@test.dev",
        password: "password123",
        totpCode: generateTotp(enrolment.secret, { now }),
      },
      META,
    );
    expect(ok.tokens.accessToken).toBeTruthy();
  });
});

describe("changePassword", () => {
  async function seedUser() {
    const ctx = build();
    await ctx.service.register(
      { email: "pw@test.dev", password: "password123", fullName: null, phone: null },
      META,
    );
    const profile = [...ctx.repo.profiles.values()][0] as ProfileRecord;
    const principal = { userId: profile.id, sessionId: randomUUID(), companyId: null };
    return { ...ctx, principal };
  }

  it("changes the password when the current one is correct", async () => {
    const { service, principal, audit } = await seedUser();
    await service.changePassword(principal, "password123", "newpassword456");

    const relogin = await service.login(
      { email: "pw@test.dev", password: "newpassword456", totpCode: null },
      META,
    );
    expect(relogin.tokens.accessToken).toBeTruthy();
    expect(audit.events).toContain("auth.password_changed");
  });

  it("rejects a wrong current password", async () => {
    const { service, principal } = await seedUser();
    await expect(
      service.changePassword(principal, "wrong-current", "newpassword456"),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("requestAccountDeletion", () => {
  it("flags the account and records an audit event", async () => {
    const ctx = build();
    await ctx.service.register(
      { email: "del@test.dev", password: "password123", fullName: null, phone: null },
      META,
    );
    const profile = [...ctx.repo.profiles.values()][0] as ProfileRecord;
    const principal = { userId: profile.id, sessionId: randomUUID(), companyId: null };

    await ctx.service.requestAccountDeletion(principal);

    expect(ctx.repo.profiles.get(principal.userId)?.deletionRequestedAt).not.toBeNull();
    expect(ctx.audit.events).toContain("auth.account_deletion_requested");
  });

  it("is idempotent — a second request does not move the timestamp", async () => {
    const ctx = build();
    await ctx.service.register(
      { email: "del2@test.dev", password: "password123", fullName: null, phone: null },
      META,
    );
    const profile = [...ctx.repo.profiles.values()][0] as ProfileRecord;
    const principal = { userId: profile.id, sessionId: randomUUID(), companyId: null };

    await ctx.service.requestAccountDeletion(principal);
    const first = ctx.repo.profiles.get(principal.userId)?.deletionRequestedAt;
    now += 1000;
    await ctx.service.requestAccountDeletion(principal);

    expect(ctx.repo.profiles.get(principal.userId)?.deletionRequestedAt).toEqual(first);
  });
});

describe("reissueForCompany (tenant switch)", () => {
  it("rebinds the session to a company and rotates the refresh token", async () => {
    const ctx = build();
    await ctx.service.register(
      { email: "sw@test.dev", password: "password123", fullName: null, phone: null },
      META,
    );
    const session = [...ctx.repo.sessions.values()][0] as SessionRecord;
    const principal = { userId: session.userId, sessionId: session.id, companyId: null };
    const companyId = randomUUID();

    now += 1000;
    const tokens = await ctx.service.reissueForCompany(principal, companyId);
    expect(tokens.accessToken).toBeTruthy();

    const rebound = ctx.repo.sessions.get(session.id);
    expect(rebound?.companyId).toBe(companyId);
    // The refresh token was rotated, so the new token still refreshes cleanly.
    now += 1000;
    const refreshed = await ctx.service.refresh(tokens.refreshToken, META);
    expect(refreshed.refreshToken).not.toBe(tokens.refreshToken);
  });
});
