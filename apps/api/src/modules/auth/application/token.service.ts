import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { signJwt, verifyJwt } from "@cadeau/crypto";
import { APP_CONFIG, type InjectedAppConfig } from "../../../shared/config/config.tokens";
import { CLOCK, type Clock } from "../../../shared/time/clock";
import { TOKEN_TYPE } from "../../../shared/auth/token-claims";

/** Verified refresh-token identity returned by {@link TokenService.verifyRefreshToken}. */
export interface RefreshIdentity {
  readonly userId: string;
  readonly sessionId: string;
  readonly familyId: string;
}

/** Inputs to mint a fresh token pair for a session. */
export interface IssueTokensInput {
  readonly userId: string;
  readonly sessionId: string;
  readonly familyId: string;
  readonly companyId: string | null;
}

/** The minted pair plus the refresh-token hash to persist and its lifetime. */
export interface IssuedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly refreshTokenHash: string;
  readonly accessExpiresInSeconds: number;
  readonly refreshExpiresAt: Date;
}

const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)?$/;
const UNIT_SECONDS: Record<string, number> = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400 };

/**
 * Parse a config duration (`5m`, `1d`, `3600s`, `500ms`, or bare ms) into whole
 * seconds (min 1). The value is already schema-validated by `@cadeau/config`, so
 * a malformed string here is a programmer error, not user input.
 */
export function parseDurationSeconds(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());
  if (match === null) {
    throw new Error(`Invalid duration: "${value}".`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "ms";
  return Math.max(1, Math.round(amount * (UNIT_SECONDS[unit] as number)));
}

/**
 * Issues and verifies the self-built access/refresh JWTs (`@cadeau/crypto`,
 * HS256). Access and refresh tokens use different secrets and a `typ` claim, so
 * neither can be used in place of the other. The refresh token is stored only as
 * a SHA-256 hash (a one-way index over an already-random token) for rotation and
 * reuse detection — the token itself never touches the database.
 */
@Injectable()
export class TokenService {
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlSeconds: number;

  constructor(
    @Inject(APP_CONFIG) private readonly config: InjectedAppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.accessTtlSeconds = parseDurationSeconds(config.jwt.accessTtl);
    this.refreshTtlSeconds = parseDurationSeconds(config.jwt.refreshTtl);
  }

  /** Mint an access + refresh pair for a session. */
  issueTokens(input: IssueTokensInput): IssuedTokens {
    const now = this.clock.now();
    const { jwt } = this.config;

    const accessToken = signJwt(
      { sub: input.userId, typ: TOKEN_TYPE.access, sid: input.sessionId, cid: input.companyId },
      jwt.accessSecret,
      { expiresInSeconds: this.accessTtlSeconds, issuer: jwt.issuer, now },
    );

    const refreshToken = signJwt(
      {
        sub: input.userId,
        typ: TOKEN_TYPE.refresh,
        sid: input.sessionId,
        fid: input.familyId,
        jti: randomUUID(),
      },
      jwt.refreshSecret,
      { expiresInSeconds: this.refreshTtlSeconds, issuer: jwt.issuer, now },
    );

    return {
      accessToken,
      refreshToken,
      refreshTokenHash: this.hashRefreshToken(refreshToken),
      accessExpiresInSeconds: this.accessTtlSeconds,
      refreshExpiresAt: new Date(now + this.refreshTtlSeconds * 1000),
    };
  }

  /**
   * Verify a refresh token's signature, issuer, expiry, and kind, returning its
   * identity. Throws (`@cadeau/crypto` `JwtError`) on any invalid/expired token;
   * the caller maps that to a unified `401`.
   */
  verifyRefreshToken(token: string): RefreshIdentity {
    const claims = verifyJwt(token, this.config.jwt.refreshSecret, {
      issuer: this.config.jwt.issuer,
      now: this.clock.now(),
    });
    const sessionId = claims["sid"];
    const familyId = claims["fid"];
    if (
      claims["typ"] !== TOKEN_TYPE.refresh ||
      typeof claims.sub !== "string" ||
      typeof sessionId !== "string" ||
      typeof familyId !== "string"
    ) {
      throw new Error("Not a refresh token.");
    }
    return { userId: claims.sub, sessionId, familyId };
  }

  /** SHA-256 hex hash of a refresh token — what we persist and look up by. */
  hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
