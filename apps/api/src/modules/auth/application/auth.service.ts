import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  buildOtpAuthUri,
  decrypt,
  encrypt,
  generateTotpSecret,
  hashPassword,
  verifyPassword,
  verifyTotp,
} from "@cadeau/crypto";
import { APP_CONFIG, type InjectedAppConfig } from "../../../shared/config/config.tokens";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { SessionReissuePort } from "../../../shared/contracts/session-reissue.port";
import { AppErrors, AppException } from "../../../shared/errors/app-exception";
import { CLOCK, type Clock } from "../../../shared/time/clock";
import { AUTH_AUDIT, type AuthAuditPort } from "../domain/auth-audit.port";
import { AUTH_REPOSITORY, type AuthRepositoryPort } from "../domain/auth-repository.port";
import { EmailAlreadyExistsError } from "../domain/auth.errors";
import type {
  AuthResult,
  ProfileRecord,
  RequestMeta,
  SessionRecord,
  SessionView,
  TokenPair,
  TwoFactorEnrolment,
} from "../domain/auth.types";
import { TokenService } from "./token.service";

/** Issuer label shown in authenticator apps for enrolled TOTP accounts. */
const TOTP_ISSUER_LABEL = "Cadeau CRM";

/** Registration input (already validated + normalized by the DTO). */
export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly fullName: string | null;
  readonly phone: string | null;
}

/** Login input. `totpCode` is required only when the account has 2FA enabled. */
export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly totpCode: string | null;
}

/**
 * Orchestrates authentication: registration, login, refresh-token rotation with
 * reuse detection, logout, and session management. Credentials are handled via
 * `@cadeau/crypto` (scrypt) and never logged; PII (phone) is encrypted at rest.
 * All persistence goes through the {@link AuthRepositoryPort}; this service holds
 * no Prisma coupling.
 */
@Injectable()
export class AuthService implements SessionReissuePort {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repo: AuthRepositoryPort,
    @Inject(AUTH_AUDIT) private readonly audit: AuthAuditPort,
    @Inject(APP_CONFIG) private readonly config: InjectedAppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly tokens: TokenService,
  ) {}

  /** Create an account and open its first session. */
  async register(input: RegisterInput, meta: RequestMeta): Promise<AuthResult> {
    const passwordHash = await hashPassword(input.password);
    const phoneEncrypted =
      input.phone !== null ? encrypt(input.phone, this.config.encryption.key) : null;

    let profile: ProfileRecord;
    try {
      profile = await this.repo.createProfile({
        email: input.email,
        passwordHash,
        fullName: input.fullName,
        phoneEncrypted,
      });
    } catch (error) {
      if (error instanceof EmailAlreadyExistsError) {
        throw AppErrors.conflict(error.message);
      }
      throw error;
    }

    this.audit.record("auth.registered", { userId: profile.id, ipAddress: meta.ipAddress });
    const tokens = await this.openSession(profile, meta);
    return { user: this.toSummary(profile), tokens };
  }

  /** Exchange credentials for a token pair. */
  async login(input: LoginInput, meta: RequestMeta): Promise<AuthResult> {
    const profile = await this.repo.findProfileByEmail(input.email);

    if (profile === null) {
      // Spend a comparable amount of work so a missing account is not
      // distinguishable from a wrong password by response timing.
      await hashPassword(input.password);
      this.audit.record("auth.login_failed", {
        emailAttempted: input.email,
        ipAddress: meta.ipAddress,
      });
      throw AppErrors.unauthorized("Invalid email or password.");
    }

    const ok = await verifyPassword(input.password, profile.passwordHash);
    if (!ok) {
      this.audit.record("auth.login_failed", {
        userId: profile.id,
        emailAttempted: input.email,
        ipAddress: meta.ipAddress,
      });
      throw AppErrors.unauthorized("Invalid email or password.");
    }

    if (profile.totpEnabledAt !== null) {
      this.assertTotpChallenge(profile, input.totpCode, meta);
    }

    this.audit.record("auth.logged_in", { userId: profile.id, ipAddress: meta.ipAddress });
    const tokens = await this.openSession(profile, meta);
    return { user: this.toSummary(profile), tokens };
  }

  /**
   * Enforce the 2FA challenge for an account with TOTP enabled. A missing code
   * yields a `401` flagged `twoFactorRequired` so the client can prompt for it; a
   * wrong code is an ordinary invalid-credentials `401`. Secrets never leave here.
   */
  private assertTotpChallenge(
    profile: ProfileRecord,
    totpCode: string | null,
    meta: RequestMeta,
  ): void {
    if (totpCode === null) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        "UNAUTHORIZED",
        "Two-factor authentication code required.",
        { twoFactorRequired: true },
      );
    }
    if (profile.totpSecretEncrypted === null) {
      // Enabled with no secret should be impossible; fail closed.
      throw AppErrors.unauthorized("Invalid email or password.");
    }
    const secret = decrypt(profile.totpSecretEncrypted, this.config.encryption.key);
    if (!verifyTotp(totpCode, secret, { now: this.clock.now() })) {
      this.audit.record("auth.2fa_failed", { userId: profile.id, ipAddress: meta.ipAddress });
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        "UNAUTHORIZED",
        "Invalid two-factor authentication code.",
        { twoFactorRequired: true },
      );
    }
  }

  /**
   * Begin TOTP enrolment: generate a fresh secret, store it encrypted (unconfirmed
   * until a code verifies), and return the secret + otpauth URI to show once.
   */
  async enrollTotp(principal: RequestPrincipal): Promise<TwoFactorEnrolment> {
    const profile = await this.repo.findOwnProfileById(principal.userId);
    if (profile === null) {
      throw AppErrors.unauthorized();
    }
    const secret = generateTotpSecret();
    await this.repo.setTotpSecret(principal.userId, encrypt(secret, this.config.encryption.key));
    this.audit.record("auth.2fa_enrolled", { userId: principal.userId });
    return {
      secret,
      otpauthUri: buildOtpAuthUri({
        secret,
        account: profile.email,
        issuer: TOTP_ISSUER_LABEL,
      }),
    };
  }

  /** Confirm a TOTP code, enabling 2FA on the caller's account. */
  async verifyTotpEnrolment(principal: RequestPrincipal, code: string): Promise<void> {
    const profile = await this.repo.findOwnProfileById(principal.userId);
    if (profile === null) {
      throw AppErrors.unauthorized();
    }
    if (profile.totpSecretEncrypted === null) {
      throw AppErrors.badRequest("Two-factor enrolment has not been started.");
    }
    const secret = decrypt(profile.totpSecretEncrypted, this.config.encryption.key);
    if (!verifyTotp(code, secret, { now: this.clock.now() })) {
      this.audit.record("auth.2fa_failed", { userId: principal.userId });
      throw AppErrors.unauthorized("Invalid two-factor authentication code.");
    }
    await this.repo.enableTotp(principal.userId, new Date(this.clock.now()));
    this.audit.record("auth.2fa_enabled", { userId: principal.userId });
  }

  /**
   * Change the caller's password after verifying their current one. Sessions
   * are left intact — the caller stays signed in on this and other devices.
   */
  async changePassword(
    principal: RequestPrincipal,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const profile = await this.repo.findOwnProfileById(principal.userId);
    if (profile === null) {
      throw AppErrors.unauthorized();
    }
    const ok = await verifyPassword(currentPassword, profile.passwordHash);
    if (!ok) {
      throw AppErrors.badRequest("Current password is incorrect.");
    }
    const passwordHash = await hashPassword(newPassword);
    await this.repo.setPasswordHash(principal.userId, passwordHash);
    this.audit.record("auth.password_changed", { userId: principal.userId });
  }

  /**
   * Flag the caller's account for deletion. This does not erase any data — it
   * records a request for manual/compliance review. Idempotent: a second call
   * after one already succeeded is a no-op.
   */
  async requestAccountDeletion(principal: RequestPrincipal): Promise<void> {
    await this.repo.requestAccountDeletion(principal.userId, new Date(this.clock.now()));
    this.audit.record("auth.account_deletion_requested", { userId: principal.userId });
  }

  /**
   * Re-issue the caller's current session scoped to `companyId`, rotating its
   * refresh token and stamping the tenant into the new access token. Called when
   * a company is created or switched into; the caller's active tenant is proven by
   * the tenancy layer (membership) before this runs.
   */
  async reissueForCompany(principal: RequestPrincipal, companyId: string): Promise<TokenPair> {
    const newFamilyId = randomUUID(); // rotate into a fresh family; the old refresh is retired
    const issued = this.tokens.issueTokens({
      userId: principal.userId,
      sessionId: principal.sessionId,
      familyId: newFamilyId,
      companyId,
    });
    const bound = await this.repo.bindSessionCompany({
      sessionId: principal.sessionId,
      userId: principal.userId,
      companyId,
      newFamilyId,
      newRefreshTokenHash: issued.refreshTokenHash,
      newExpiresAt: issued.refreshExpiresAt,
    });
    if (bound === null) {
      throw AppErrors.unauthorized("Session is no longer active.");
    }
    this.audit.record("auth.company_switched", {
      userId: principal.userId,
      sessionId: principal.sessionId,
      companyId,
    });
    return this.toTokenPair(issued);
  }

  /**
   * Rotate a refresh token. The presented token must verify AND still be the
   * session's current token. Presenting a validly-signed but already-rotated
   * token (or losing the rotation race) is treated as reuse: the whole family is
   * revoked and the request rejected.
   */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<TokenPair> {
    let identity: ReturnType<TokenService["verifyRefreshToken"]>;
    try {
      identity = this.tokens.verifyRefreshToken(refreshToken);
    } catch {
      throw AppErrors.unauthorized("Invalid or expired refresh token.");
    }

    const presentedHash = this.tokens.hashRefreshToken(refreshToken);
    const session = await this.repo.findSessionByRefreshHash(presentedHash);

    if (session === null || session.familyId !== identity.familyId) {
      // Validly signed but not the current token ⇒ a rotated (or forged) token
      // is being replayed. Burn the family and reject.
      await this.repo.revokeFamily(identity.familyId);
      this.audit.record("auth.token_reuse_detected", {
        userId: identity.userId,
        sessionId: identity.sessionId,
        familyId: identity.familyId,
        ipAddress: meta.ipAddress,
      });
      throw AppErrors.unauthorized("Refresh token has been revoked.");
    }

    if (session.revokedAt !== null || session.expiresAt.getTime() <= this.clock.now()) {
      throw AppErrors.unauthorized("Invalid or expired refresh token.");
    }

    const issued = this.tokens.issueTokens({
      userId: session.userId,
      sessionId: session.id,
      familyId: session.familyId,
      companyId: session.companyId,
    });
    const rotated = await this.repo.rotateSession({
      sessionId: session.id,
      expectedHash: presentedHash,
      newRefreshTokenHash: issued.refreshTokenHash,
      newExpiresAt: issued.refreshExpiresAt,
    });
    if (rotated === null) {
      // Lost the compare-and-set: another request already rotated this token.
      await this.repo.revokeFamily(session.familyId);
      this.audit.record("auth.token_reuse_detected", {
        userId: session.userId,
        sessionId: session.id,
        familyId: session.familyId,
        ipAddress: meta.ipAddress,
      });
      throw AppErrors.unauthorized("Refresh token has been revoked.");
    }

    this.audit.record("auth.token_refreshed", {
      userId: session.userId,
      sessionId: session.id,
      ipAddress: meta.ipAddress,
    });
    return this.toTokenPair(issued);
  }

  /** Revoke the caller's current session. Idempotent. */
  async logout(principal: RequestPrincipal): Promise<void> {
    await this.repo.revokeOwnSession(principal.userId, principal.sessionId);
    this.audit.record("auth.logged_out", {
      userId: principal.userId,
      sessionId: principal.sessionId,
    });
  }

  /** List the caller's sessions, newest first, flagging the current one. */
  async listSessions(principal: RequestPrincipal): Promise<SessionView[]> {
    const sessions = await this.repo.listOwnSessions(principal.userId);
    return sessions.map((session) => this.toSessionView(session, principal.sessionId));
  }

  /** Revoke a specific session the caller owns. */
  async revokeSession(principal: RequestPrincipal, sessionId: string): Promise<void> {
    const session = await this.repo.findOwnSessionById(principal.userId, sessionId);
    if (session === null) {
      throw AppErrors.notFound("Session not found.");
    }
    await this.repo.revokeOwnSession(principal.userId, sessionId);
    this.audit.record("auth.session_revoked", { userId: principal.userId, sessionId });
  }

  private async openSession(profile: ProfileRecord, meta: RequestMeta): Promise<TokenPair> {
    const sessionId = randomUUID();
    const familyId = randomUUID();
    // No active tenant until the user creates/joins a company (M4.4).
    const issued = this.tokens.issueTokens({
      userId: profile.id,
      sessionId,
      familyId,
      companyId: null,
    });
    await this.repo.createSession({
      id: sessionId,
      userId: profile.id,
      companyId: null,
      familyId,
      refreshTokenHash: issued.refreshTokenHash,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
      expiresAt: issued.refreshExpiresAt,
    });
    return this.toTokenPair(issued);
  }

  private toTokenPair(issued: {
    accessToken: string;
    refreshToken: string;
    accessExpiresInSeconds: number;
  }): TokenPair {
    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresInSeconds: issued.accessExpiresInSeconds,
    };
  }

  private toSummary(profile: ProfileRecord): UserSummaryLike {
    return { id: profile.id, email: profile.email, fullName: profile.fullName };
  }

  private toSessionView(session: SessionRecord, currentSessionId: string): SessionView {
    return {
      id: session.id,
      current: session.id === currentSessionId,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
    };
  }
}

/** Local alias so `toSummary`'s return is explicit without re-importing. */
type UserSummaryLike = AuthResult["user"];
