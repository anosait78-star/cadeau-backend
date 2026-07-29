import { createHmac, timingSafeEqual } from "node:crypto";
import { JwtError } from "./errors";

/**
 * Minimal, self-built JWT (HS256) — the locked stack mandates a fully in-house
 * auth system with no external identity service. Only HS256 is supported and the
 * `alg` header is verified, so the classic `alg:"none"` and algorithm-confusion
 * downgrade attacks are rejected. Signatures are compared in constant time.
 *
 * This is a deliberately small subset of the JWT spec (HS256 + `iss`/`iat`/`exp`)
 * — enough for access/refresh tokens, nothing more.
 */
const HEADER = { alg: "HS256", typ: "JWT" } as const;

/** Registered claims we set/verify, plus any custom fields. */
export interface JwtClaims {
  readonly sub: string;
  readonly iat: number;
  readonly exp: number;
  readonly iss?: string;
  readonly [claim: string]: unknown;
}

export interface SignOptions {
  /** Token lifetime in seconds (from `iat`). */
  readonly expiresInSeconds: number;
  /** Optional issuer (`iss`). */
  readonly issuer?: string;
  /** Override "now" (ms since epoch) — for tests. */
  readonly now?: number;
}

export interface VerifyOptions {
  /** Require this issuer if set. */
  readonly issuer?: string;
  /** Override "now" (ms since epoch) — for tests. */
  readonly now?: number;
}

function encodeSegment(value: object): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sign(signingInput: string, secret: string): string {
  return createHmac("sha256", secret).update(signingInput).digest("base64url");
}

function nowSeconds(overrideMs?: number): number {
  return Math.floor((overrideMs ?? Date.now()) / 1000);
}

/** Sign a payload into an HS256 JWT, stamping `iat`/`exp` (and `iss` if given). */
export function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  options: SignOptions,
): string {
  const iat = nowSeconds(options.now);
  const claims = {
    ...payload,
    ...(options.issuer !== undefined ? { iss: options.issuer } : {}),
    iat,
    exp: iat + options.expiresInSeconds,
  };
  const signingInput = `${encodeSegment(HEADER)}.${encodeSegment(claims)}`;
  return `${signingInput}.${sign(signingInput, secret)}`;
}

/**
 * Verify an HS256 JWT and return its claims. Throws {@link JwtError} on a
 * malformed token, unsupported algorithm, bad signature, expiry, or issuer
 * mismatch. The signature is checked *before* the payload is trusted.
 */
export function verifyJwt(token: string, secret: string, options: VerifyOptions = {}): JwtClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtError("Malformed token.");
  const [encodedHeader, encodedPayload, signature] = parts as [string, string, string];

  const expected = sign(`${encodedHeader}.${encodedPayload}`, secret);
  const provided = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length || !timingSafeEqual(provided, expectedBuf)) {
    throw new JwtError("Invalid signature.");
  }

  const header = decodeJson(encodedHeader, "header");
  if (header["alg"] !== HEADER.alg) throw new JwtError("Unsupported algorithm.");

  const claims = decodeJson(encodedPayload, "payload") as JwtClaims;
  if (typeof claims.exp !== "number" || nowSeconds(options.now) >= claims.exp) {
    throw new JwtError("Token expired.");
  }
  if (options.issuer !== undefined && claims.iss !== options.issuer) {
    throw new JwtError("Issuer mismatch.");
  }
  return claims;
}

function decodeJson(segment: string, what: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new JwtError(`Malformed token ${what}.`);
  }
}
