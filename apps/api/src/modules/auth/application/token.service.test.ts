import { verifyJwt } from "@cadeau/crypto";
import { getConfig } from "@cadeau/config";
import { describe, expect, it } from "vitest";
import type { Clock } from "../../../shared/time/clock";
import { TOKEN_TYPE } from "../../../shared/auth/token-claims";
import { parseDurationSeconds, TokenService } from "./token.service";

const config = getConfig();
const T = 1_700_000_000_000; // fixed "now" in ms

function makeService(nowMs = T): { service: TokenService; clock: Clock } {
  const clock: Clock = { now: () => nowMs };
  return { service: new TokenService(config, clock), clock };
}

describe("parseDurationSeconds", () => {
  it("parses units and bare milliseconds", () => {
    expect(parseDurationSeconds("5m")).toBe(300);
    expect(parseDurationSeconds("1d")).toBe(86400);
    expect(parseDurationSeconds("3600s")).toBe(3600);
    expect(parseDurationSeconds("2h")).toBe(7200);
    expect(parseDurationSeconds("500ms")).toBe(1); // rounds up to the 1s floor
    expect(parseDurationSeconds("1500")).toBe(2); // bare ms → 1.5s → round → 2
  });

  it("throws on a malformed duration", () => {
    expect(() => parseDurationSeconds("soon")).toThrow(/Invalid duration/);
  });
});

describe("TokenService.issueTokens", () => {
  it("mints a verifiable access token carrying the principal", () => {
    const { service } = makeService();
    const issued = service.issueTokens({
      userId: "user-1",
      sessionId: "sess-1",
      familyId: "fam-1",
      companyId: null,
    });

    const claims = verifyJwt(issued.accessToken, config.jwt.accessSecret, {
      issuer: config.jwt.issuer,
      now: T,
    });
    expect(claims.sub).toBe("user-1");
    expect(claims["typ"]).toBe(TOKEN_TYPE.access);
    expect(claims["sid"]).toBe("sess-1");
    expect(claims["cid"]).toBeNull();
    expect(issued.accessExpiresInSeconds).toBe(300);
    expect(issued.refreshExpiresAt.getTime()).toBe(T + 86400 * 1000);
    expect(issued.refreshTokenHash).toBe(service.hashRefreshToken(issued.refreshToken));
  });

  it("mints unique refresh tokens even at the same instant (jti)", () => {
    const { service } = makeService();
    const input = { userId: "u", sessionId: "s", familyId: "f", companyId: null } as const;
    const a = service.issueTokens(input);
    const b = service.issueTokens(input);
    expect(a.refreshToken).not.toBe(b.refreshToken);
    expect(a.refreshTokenHash).not.toBe(b.refreshTokenHash);
  });
});

describe("TokenService.verifyRefreshToken", () => {
  it("returns the identity of a valid refresh token", () => {
    const { service } = makeService();
    const issued = service.issueTokens({
      userId: "user-9",
      sessionId: "sess-9",
      familyId: "fam-9",
      companyId: null,
    });
    expect(service.verifyRefreshToken(issued.refreshToken)).toEqual({
      userId: "user-9",
      sessionId: "sess-9",
      familyId: "fam-9",
    });
  });

  it("rejects an access token presented as a refresh token", () => {
    const { service } = makeService();
    const issued = service.issueTokens({
      userId: "u",
      sessionId: "s",
      familyId: "f",
      companyId: null,
    });
    expect(() => service.verifyRefreshToken(issued.accessToken)).toThrow();
  });

  it("rejects an expired refresh token", () => {
    const { service } = makeService();
    const issued = service.issueTokens({
      userId: "u",
      sessionId: "s",
      familyId: "f",
      companyId: null,
    });
    // A verifier whose clock is past the refresh TTL rejects it.
    const later = new TokenService(config, { now: () => T + 2 * 86400 * 1000 });
    expect(() => later.verifyRefreshToken(issued.refreshToken)).toThrow();
  });
});
