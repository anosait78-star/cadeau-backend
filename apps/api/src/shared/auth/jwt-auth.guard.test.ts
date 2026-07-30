import { type ExecutionContext } from "@nestjs/common";
import { getConfig } from "@cadeau/config";
import { signJwt } from "@cadeau/crypto";
import { describe, expect, it } from "vitest";
import { TokenService } from "../../modules/auth/application/token.service";
import type { Clock } from "../time/clock";
import type { AuthenticatedRequest } from "./authenticated-request";
import { JwtAuthGuard } from "./jwt-auth.guard";

const config = getConfig();
const T = 1_700_000_000_000;
const clock: Clock = { now: () => T };

function context(authorization?: string): { ctx: ExecutionContext; req: AuthenticatedRequest } {
  const req = {
    header: (name: string) => (name.toLowerCase() === "authorization" ? authorization : undefined),
  } as unknown as AuthenticatedRequest;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function accessTokenFor(): string {
  return new TokenService(config, clock).issueTokens({
    userId: "user-1",
    sessionId: "sess-1",
    familyId: "fam-1",
    companyId: null,
  }).accessToken;
}

describe("JwtAuthGuard", () => {
  const guard = new JwtAuthGuard(config, clock);

  it("attaches the principal for a valid access token", () => {
    const { ctx, req } = context(`Bearer ${accessTokenFor()}`);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.principal).toEqual({ userId: "user-1", sessionId: "sess-1", companyId: null });
  });

  it("rejects a missing or malformed Authorization header", () => {
    expect(() => guard.canActivate(context(undefined).ctx)).toThrowError(/Authorization/);
    expect(() => guard.canActivate(context("Basic abc").ctx)).toThrowError(/Authorization/);
  });

  it("rejects a refresh token used as an access token", () => {
    const refresh = new TokenService(config, clock).issueTokens({
      userId: "u",
      sessionId: "s",
      familyId: "f",
      companyId: null,
    }).refreshToken;
    expect(() => guard.canActivate(context(`Bearer ${refresh}`).ctx)).toThrowError(/access token/);
  });

  it("rejects an expired access token", () => {
    const token = accessTokenFor();
    const lateGuard = new JwtAuthGuard(config, { now: () => T + 3600 * 1000 });
    expect(() => lateGuard.canActivate(context(`Bearer ${token}`).ctx)).toThrow();
  });

  it("rejects a token signed with the wrong secret", () => {
    const forged = signJwt(
      { sub: "x", typ: "access", sid: "s", cid: null },
      "wrong-secret-".repeat(3),
      {
        expiresInSeconds: 300,
        issuer: config.jwt.issuer,
        now: T,
      },
    );
    expect(() => guard.canActivate(context(`Bearer ${forged}`).ctx)).toThrow();
  });

  it("rejects a valid-signature token missing the session id", () => {
    const token = signJwt({ sub: "x", typ: "access", cid: null }, config.jwt.accessSecret, {
      expiresInSeconds: 300,
      issuer: config.jwt.issuer,
      now: T,
    });
    expect(() => guard.canActivate(context(`Bearer ${token}`).ctx)).toThrow();
  });
});
