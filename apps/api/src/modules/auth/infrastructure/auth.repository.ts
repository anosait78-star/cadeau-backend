import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient, setUserContext } from "@cadeau/database";
import type { AuthRepositoryPort } from "../domain/auth-repository.port";
import { EmailAlreadyExistsError } from "../domain/auth.errors";
import type { NewProfile, NewSession, ProfileRecord, SessionRecord } from "../domain/auth.types";
import { PRISMA_CLIENT } from "./prisma-client.provider";

// Column projections: never select the password hash into a record that leaves
// the repository unless a caller explicitly needs it (login does, via the full
// ProfileRecord). Sessions never expose token material beyond the stored hash.
const SESSION_SELECT = {
  id: true,
  userId: true,
  companyId: true,
  familyId: true,
  refreshTokenHash: true,
  userAgent: true,
  ipAddress: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

type SessionRow = Prisma.SessionGetPayload<{ select: typeof SESSION_SELECT }>;

/**
 * Prisma-backed {@link AuthRepositoryPort}. The ONLY place in the auth module
 * that touches `@cadeau/database` (architecture test:
 * `data-access-only-in-infrastructure`).
 *
 * Pre-authentication operations run without a bound principal — the migration's
 * null-context bootstrap path — and are scoped explicitly by the key they carry
 * (email / token hash). Self-service operations bind the principal via
 * `setUserContext`, so RLS scopes them to the caller in addition to the explicit
 * `userId` filter (defence in depth).
 */
@Injectable()
export class AuthRepository implements AuthRepositoryPort {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findProfileByEmail(email: string): Promise<ProfileRecord | null> {
    const row = await this.prisma.profile.findUnique({ where: { email } });
    return row === null ? null : toProfileRecord(row);
  }

  async createProfile(input: NewProfile): Promise<ProfileRecord> {
    try {
      const row = await this.prisma.profile.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
          fullName: input.fullName,
          phoneEncrypted: input.phoneEncrypted,
        },
      });
      return toProfileRecord(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new EmailAlreadyExistsError();
      }
      throw error;
    }
  }

  async createSession(input: NewSession): Promise<SessionRecord> {
    const row = await this.prisma.session.create({
      data: {
        id: input.id,
        userId: input.userId,
        companyId: input.companyId,
        familyId: input.familyId,
        refreshTokenHash: input.refreshTokenHash,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
        expiresAt: input.expiresAt,
      },
      select: SESSION_SELECT,
    });
    return toSessionRecord(row);
  }

  async findSessionByRefreshHash(refreshTokenHash: string): Promise<SessionRecord | null> {
    const row = await this.prisma.session.findUnique({
      where: { refreshTokenHash },
      select: SESSION_SELECT,
    });
    return row === null ? null : toSessionRecord(row);
  }

  async rotateSession(input: {
    readonly sessionId: string;
    readonly expectedHash: string;
    readonly newRefreshTokenHash: string;
    readonly newExpiresAt: Date;
  }): Promise<SessionRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      // Compare-and-set: only rotate if this is still the current, live token.
      const updated = await tx.session.updateMany({
        where: { id: input.sessionId, refreshTokenHash: input.expectedHash, revokedAt: null },
        data: { refreshTokenHash: input.newRefreshTokenHash, expiresAt: input.newExpiresAt },
      });
      if (updated.count === 0) return null;
      const row = await tx.session.findUnique({
        where: { id: input.sessionId },
        select: SESSION_SELECT,
      });
      return row === null ? null : toSessionRecord(row);
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async findOwnSessionById(userId: string, sessionId: string): Promise<SessionRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      await setUserContext(tx, userId);
      const row = await tx.session.findFirst({
        where: { id: sessionId, userId },
        select: SESSION_SELECT,
      });
      return row === null ? null : toSessionRecord(row);
    });
  }

  async revokeOwnSession(userId: string, sessionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await setUserContext(tx, userId);
      await tx.session.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async listOwnSessions(userId: string): Promise<SessionRecord[]> {
    const rows = await this.prisma.$transaction(async (tx) => {
      await setUserContext(tx, userId);
      return tx.session.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: SESSION_SELECT,
      });
    });
    return rows.map(toSessionRecord);
  }

  async findOwnProfileById(userId: string): Promise<ProfileRecord | null> {
    const row = await this.prisma.$transaction(async (tx) => {
      await setUserContext(tx, userId);
      return tx.profile.findFirst({ where: { id: userId } });
    });
    return row === null ? null : toProfileRecord(row);
  }

  async setTotpSecret(userId: string, secretEncrypted: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await setUserContext(tx, userId);
      await tx.profile.updateMany({
        where: { id: userId },
        data: { totpSecretEncrypted: secretEncrypted, totpEnabledAt: null },
      });
    });
  }

  async enableTotp(userId: string, enabledAt: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await setUserContext(tx, userId);
      await tx.profile.updateMany({ where: { id: userId }, data: { totpEnabledAt: enabledAt } });
    });
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await setUserContext(tx, userId);
      await tx.profile.updateMany({ where: { id: userId }, data: { passwordHash } });
    });
  }

  async requestAccountDeletion(userId: string, requestedAt: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await setUserContext(tx, userId);
      await tx.profile.updateMany({
        where: { id: userId, deletionRequestedAt: null },
        data: { deletionRequestedAt: requestedAt },
      });
    });
  }

  async bindSessionCompany(input: {
    readonly sessionId: string;
    readonly userId: string;
    readonly companyId: string;
    readonly newFamilyId: string;
    readonly newRefreshTokenHash: string;
    readonly newExpiresAt: Date;
  }): Promise<SessionRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      await setUserContext(tx, input.userId);
      const updated = await tx.session.updateMany({
        where: { id: input.sessionId, userId: input.userId, revokedAt: null },
        data: {
          companyId: input.companyId,
          familyId: input.newFamilyId,
          refreshTokenHash: input.newRefreshTokenHash,
          expiresAt: input.newExpiresAt,
        },
      });
      if (updated.count === 0) return null;
      const row = await tx.session.findFirst({
        where: { id: input.sessionId, userId: input.userId },
        select: SESSION_SELECT,
      });
      return row === null ? null : toSessionRecord(row);
    });
  }
}

function toProfileRecord(row: {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string | null;
  phoneEncrypted: string | null;
  totpSecretEncrypted: string | null;
  totpEnabledAt: Date | null;
  deletionRequestedAt: Date | null;
  createdAt: Date;
}): ProfileRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    fullName: row.fullName,
    phoneEncrypted: row.phoneEncrypted,
    totpSecretEncrypted: row.totpSecretEncrypted,
    totpEnabledAt: row.totpEnabledAt,
    deletionRequestedAt: row.deletionRequestedAt,
    createdAt: row.createdAt,
  };
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    companyId: row.companyId,
    familyId: row.familyId,
    refreshTokenHash: row.refreshTokenHash,
    userAgent: row.userAgent,
    ipAddress: row.ipAddress,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}
