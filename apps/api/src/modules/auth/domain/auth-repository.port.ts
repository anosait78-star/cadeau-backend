import type { NewProfile, NewSession, ProfileRecord, SessionRecord } from "./auth.types";

/**
 * Persistence port for auth. The application layer depends on this interface;
 * the Prisma-backed adapter lives in the infrastructure layer, so the inner
 * layers never touch `@cadeau/database` directly (architecture test:
 * `data-access-only-in-infrastructure`).
 *
 * Isolation note: implementations run the pre-authentication reads/writes
 * (create/find profile, create/find session) with no principal bound — the
 * bootstrap window — and the self-service reads (list/revoke/find own session)
 * with the principal bound so RLS scopes them. Callers still pass the id they
 * expect, so scoping is never trusted to a single layer.
 */
export interface AuthRepositoryPort {
  /** Look up a profile by (case-insensitive) email, or null. Pre-auth (login). */
  findProfileByEmail(email: string): Promise<ProfileRecord | null>;

  /**
   * Create a profile. Rejects with {@link EmailAlreadyExistsError} when the email
   * is already taken (unique constraint). Pre-auth (register).
   */
  createProfile(input: NewProfile): Promise<ProfileRecord>;

  /** Open a new session (refresh-token family). Pre-auth completion (login). */
  createSession(input: NewSession): Promise<SessionRecord>;

  /** Find a session by the hash of a presented refresh token, or null. Pre-auth (refresh). */
  findSessionByRefreshHash(refreshTokenHash: string): Promise<SessionRecord | null>;

  /**
   * Atomically rotate a session's refresh token: set a new hash + expiry, but
   * only if it is still the current, non-revoked token. Returns the updated row,
   * or null if it was already rotated/revoked (a lost race / reuse). Pre-auth (refresh).
   */
  rotateSession(input: {
    readonly sessionId: string;
    readonly expectedHash: string;
    readonly newRefreshTokenHash: string;
    readonly newExpiresAt: Date;
  }): Promise<SessionRecord | null>;

  /** Revoke every non-revoked session in a family (reuse detection). Pre-auth (refresh). */
  revokeFamily(familyId: string): Promise<void>;

  /** Find one of the caller's sessions by id, or null. Self-service (logout/revoke). */
  findOwnSessionById(userId: string, sessionId: string): Promise<SessionRecord | null>;

  /** Revoke one of the caller's sessions (idempotent). Self-service (logout/revoke). */
  revokeOwnSession(userId: string, sessionId: string): Promise<void>;

  /** List the caller's sessions, newest first. Self-service (GET sessions). */
  listOwnSessions(userId: string): Promise<SessionRecord[]>;

  /** Load the caller's own profile by id, or null. Self-service (2FA, /me). */
  findOwnProfileById(userId: string): Promise<ProfileRecord | null>;

  /**
   * Store an (encrypted) TOTP secret for the caller, clearing any prior enabled
   * state — (re-)enrolment starts unconfirmed until a code verifies. Self-service.
   */
  setTotpSecret(userId: string, secretEncrypted: string): Promise<void>;

  /** Mark the caller's 2FA confirmed (set `totpEnabledAt`). Self-service. */
  enableTotp(userId: string, enabledAt: Date): Promise<void>;

  /** Replace the caller's password hash. Self-service. */
  setPasswordHash(userId: string, passwordHash: string): Promise<void>;

  /**
   * Flag the caller's account for deletion (idempotent — does not overwrite an
   * existing timestamp). Does not itself erase any data. Self-service.
   */
  requestAccountDeletion(userId: string, requestedAt: Date): Promise<void>;

  /**
   * Rebind the caller's current session to a company and rotate its refresh
   * token. Authorized by the access-token principal (not by presenting the
   * refresh token), so it updates by session id + owner where the session is
   * still live. Returns the updated row, or null if the session is gone/revoked.
   * Used when creating or switching the active tenant. Self-service.
   */
  bindSessionCompany(input: {
    readonly sessionId: string;
    readonly userId: string;
    readonly companyId: string;
    readonly newFamilyId: string;
    readonly newRefreshTokenHash: string;
    readonly newExpiresAt: Date;
  }): Promise<SessionRecord | null>;
}

/** DI token for {@link AuthRepositoryPort}. */
export const AUTH_REPOSITORY = Symbol("AUTH_REPOSITORY");
