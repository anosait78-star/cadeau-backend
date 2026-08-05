/**
 * Shared token-claim contracts — the single definition of what our access and
 * refresh JWTs carry, used by both the issuer (auth `TokenService`) and the
 * verifier (`JwtAuthGuard`). Access and refresh tokens are signed with different
 * secrets and tagged with `typ`, so one can never be presented in place of the
 * other even if the secrets were ever confused.
 */

/** Discriminates the two token kinds; verified on every use. */
export const TOKEN_TYPE = {
  access: "access",
  refresh: "refresh",
} as const;

export type TokenType = (typeof TOKEN_TYPE)[keyof typeof TOKEN_TYPE];

/** Custom claims on an access token (beyond the registered `sub`/`iat`/`exp`/`iss`). */
export interface AccessTokenClaims {
  /** Token kind. */
  readonly typ: typeof TOKEN_TYPE.access;
  /** Session id, so a session can be revoked and identified on logout. */
  readonly sid: string;
  /** Active tenant, or null until a company is created/joined (M4.4). */
  readonly cid: string | null;
}

/** Custom claims on a refresh token. */
export interface RefreshTokenClaims {
  readonly typ: typeof TOKEN_TYPE.refresh;
  /** Session id this refresh token belongs to. */
  readonly sid: string;
  /** Refresh-token family, revoked wholesale when reuse is detected. */
  readonly fid: string;
  /** Random per-token id, so each rotated token is unique (distinct hash). */
  readonly jti: string;
}
