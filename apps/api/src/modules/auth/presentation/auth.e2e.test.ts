import { type INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../app.module";
import { validationExceptionFactory } from "../../../shared/errors/validation";
import { RequestContextMiddleware } from "../../../shared/http/request-context.middleware";
import { AppLogger } from "../../../shared/logging/app-logger";
import { CLOCK } from "../../../shared/time/clock";
import { AUTH_REPOSITORY, type AuthRepositoryPort } from "../domain/auth-repository.port";
import { EmailAlreadyExistsError } from "../domain/auth.errors";
import type { NewProfile, NewSession, ProfileRecord, SessionRecord } from "../domain/auth.types";

/** In-memory repository so the real HTTP stack runs without a database. */
class InMemoryAuthRepo implements AuthRepositoryPort {
  private readonly profiles = new Map<string, ProfileRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private seq = 0;

  findProfileByEmail(email: string): Promise<ProfileRecord | null> {
    return Promise.resolve([...this.profiles.values()].find((p) => p.email === email) ?? null);
  }
  createProfile(input: NewProfile): Promise<ProfileRecord> {
    if ([...this.profiles.values()].some((p) => p.email === input.email)) {
      return Promise.reject(new EmailAlreadyExistsError());
    }
    const record: ProfileRecord = {
      id: `p-${++this.seq}`,
      createdAt: new Date(),
      totpSecretEncrypted: null,
      totpEnabledAt: null,
      deletionRequestedAt: null,
      ...input,
    };
    this.profiles.set(record.id, record);
    return Promise.resolve(record);
  }
  createSession(input: NewSession): Promise<SessionRecord> {
    const record: SessionRecord = { revokedAt: null, createdAt: new Date(), ...input };
    this.sessions.set(record.id, record);
    return Promise.resolve(record);
  }
  findSessionByRefreshHash(hash: string): Promise<SessionRecord | null> {
    return Promise.resolve(
      [...this.sessions.values()].find((s) => s.refreshTokenHash === hash) ?? null,
    );
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
      if (s.familyId === familyId) this.sessions.set(id, { ...s, revokedAt: new Date() });
    }
    return Promise.resolve();
  }
  findOwnSessionById(userId: string, sessionId: string): Promise<SessionRecord | null> {
    const s = this.sessions.get(sessionId);
    return Promise.resolve(s !== undefined && s.userId === userId ? s : null);
  }
  revokeOwnSession(userId: string, sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s !== undefined && s.userId === userId) {
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

describe("Auth (e2e)", () => {
  let app: INestApplication;
  let now = 1_700_000_000_000;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_REPOSITORY)
      .useValue(new InMemoryAuthRepo())
      .overrideProvider(CLOCK)
      .useValue({ now: () => now })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: validationExceptionFactory,
      }),
    );
    const requestContext = new RequestContextMiddleware(app.get(AppLogger));
    app.use(requestContext.use.bind(requestContext));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  it("runs the full register → login → refresh → logout cycle", async () => {
    // Register
    const registered = await request(server())
      .post("/v1/auth/register")
      .send({ email: "flow@test.dev", password: "password123", fullName: "Flow" });
    expect(registered.status).toBe(201);
    expect(registered.body.user).toMatchObject({ email: "flow@test.dev" });
    expect(typeof registered.body.accessToken).toBe("string");

    // Login
    const loggedIn = await request(server())
      .post("/v1/auth/login")
      .send({ email: "flow@test.dev", password: "password123" });
    expect(loggedIn.status).toBe(200);
    const { accessToken, refreshToken } = loggedIn.body as {
      accessToken: string;
      refreshToken: string;
    };

    // The access token authorizes session listing, flagging the current session.
    const sessions = await request(server())
      .get("/v1/auth/sessions")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(sessions.status).toBe(200);
    expect(sessions.body.data.length).toBeGreaterThanOrEqual(1);
    expect(sessions.body.data.some((s: { current: boolean }) => s.current)).toBe(true);

    // Refresh rotates the pair; the new access token still works.
    now += 1000;
    const refreshed = await request(server()).post("/v1/auth/refresh").send({ refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(refreshToken);

    // Reusing the old (rotated) refresh token is rejected.
    const reuse = await request(server()).post("/v1/auth/refresh").send({ refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe("UNAUTHORIZED");

    // Logout revokes the current session.
    const loggedOut = await request(server())
      .post("/v1/auth/logout")
      .set("Authorization", `Bearer ${refreshed.body.accessToken ?? accessToken}`);
    expect(loggedOut.status).toBe(204);
  });

  it("rejects an unauthenticated session listing", async () => {
    const res = await request(server()).get("/v1/auth/sessions");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns the unified validation envelope for a bad payload", async () => {
    const res = await request(server())
      .post("/v1/auth/register")
      .send({ email: "not-an-email", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("rejects an access token used where none is provided", async () => {
    const res = await request(server())
      .post("/v1/auth/logout")
      .set("Authorization", "Bearer garbage.token.here");
    expect(res.status).toBe(401);
  });

  it("enrolls TOTP and then challenges login for the 2FA code", async () => {
    const registered = await request(server())
      .post("/v1/auth/register")
      .send({ email: "tfa@test.dev", password: "password123" });
    const access = registered.body.accessToken as string;

    const enroll = await request(server())
      .post("/v1/auth/2fa/enroll")
      .set("Authorization", `Bearer ${access}`);
    expect(enroll.status).toBe(201);
    const secret = enroll.body.secret as string;
    expect(enroll.body.otpauthUri).toContain("otpauth://totp/");

    const { generateTotp } = await import("@cadeau/crypto");
    const verify = await request(server())
      .post("/v1/auth/2fa/verify")
      .set("Authorization", `Bearer ${access}`)
      .send({ code: generateTotp(secret, { now }) });
    expect(verify.status).toBe(204);

    // Login now requires the code.
    const noCode = await request(server())
      .post("/v1/auth/login")
      .send({ email: "tfa@test.dev", password: "password123" });
    expect(noCode.status).toBe(401);
    expect(noCode.body.error.details).toMatchObject({ twoFactorRequired: true });

    const withCode = await request(server())
      .post("/v1/auth/login")
      .send({
        email: "tfa@test.dev",
        password: "password123",
        totpCode: generateTotp(secret, { now }),
      });
    expect(withCode.status).toBe(200);
    expect(typeof withCode.body.accessToken).toBe("string");
  });
});
