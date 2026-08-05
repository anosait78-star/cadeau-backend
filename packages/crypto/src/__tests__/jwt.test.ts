import { describe, expect, it } from "vitest";
import { JwtError } from "../errors";
import { signJwt, verifyJwt } from "../jwt";

const SECRET = "2222222222222222222222222222222222222222";
const NOW = 1_700_000_000_000; // fixed ms for deterministic exp

describe("JWT (HS256, self-built)", () => {
  it("signs and verifies, exposing claims", () => {
    const token = signJwt({ sub: "user-1", role: "owner" }, SECRET, {
      expiresInSeconds: 300,
      issuer: "cadeau-crm",
      now: NOW,
    });
    const claims = verifyJwt(token, SECRET, { issuer: "cadeau-crm", now: NOW });
    expect(claims.sub).toBe("user-1");
    expect(claims["role"]).toBe("owner");
    expect(claims.iss).toBe("cadeau-crm");
    expect(claims.exp - claims.iat).toBe(300);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signJwt({ sub: "u" }, SECRET, { expiresInSeconds: 60, now: NOW });
    expect(() =>
      verifyJwt(token, "3333333333333333333333333333333333333333", { now: NOW }),
    ).toThrow(JwtError);
  });

  it("rejects an expired token", () => {
    const token = signJwt({ sub: "u" }, SECRET, { expiresInSeconds: 60, now: NOW });
    expect(() => verifyJwt(token, SECRET, { now: NOW + 61_000 })).toThrow(/expired/i);
  });

  it("rejects an issuer mismatch", () => {
    const token = signJwt({ sub: "u" }, SECRET, { expiresInSeconds: 60, issuer: "a", now: NOW });
    expect(() => verifyJwt(token, SECRET, { issuer: "b", now: NOW })).toThrow(/issuer/i);
  });

  it("rejects a malformed token", () => {
    expect(() => verifyJwt("only.two", SECRET)).toThrow(JwtError);
  });

  it("rejects the alg:none downgrade attack", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: "attacker", exp: Math.floor(NOW / 1000) + 999 }),
    ).toString("base64url");
    // No signature — a "none" token. Verification must reject it.
    expect(() => verifyJwt(`${header}.${payload}.`, SECRET, { now: NOW })).toThrow(JwtError);
  });
});
