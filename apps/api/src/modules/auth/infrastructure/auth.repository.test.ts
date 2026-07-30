import { Prisma, type PrismaClient } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import { EmailAlreadyExistsError } from "../domain/auth.errors";
import { AuthRepository } from "./auth.repository";

const USER = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

interface Row {
  [key: string]: unknown;
}

/** Minimal in-memory Prisma double covering exactly the calls the repo makes. */
class FakePrisma {
  readonly profiles: Row[] = [];
  readonly sessions: Row[] = [];
  readonly queryRaw = vi.fn(() => Promise.resolve([]));

  profile = {
    findUnique: ({ where }: { where: { email: string } }) =>
      Promise.resolve(this.profiles.find((p) => p["email"] === where.email) ?? null),
    findFirst: ({ where }: { where: Row }) =>
      Promise.resolve(this.profiles.find((p) => this.matches(p, where)) ?? null),
    create: ({ data }: { data: Row }) => {
      if (this.profiles.some((p) => p["email"] === data["email"])) {
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError("unique", {
            code: "P2002",
            clientVersion: "test",
          }),
        );
      }
      const row: Row = {
        id: `p${this.profiles.length + 1}`,
        createdAt: new Date(),
        totpSecretEncrypted: null,
        totpEnabledAt: null,
        ...data,
      };
      this.profiles.push(row);
      return Promise.resolve(row);
    },
    updateMany: ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const p of this.profiles) {
        if (this.matches(p, where)) {
          Object.assign(p, data);
          count += 1;
        }
      }
      return Promise.resolve({ count });
    },
  };

  session = {
    create: ({ data }: { data: Row }) => {
      const row: Row = { revokedAt: null, createdAt: new Date(), ...data };
      this.sessions.push(row);
      return Promise.resolve(row);
    },
    findUnique: ({ where }: { where: Row }) => Promise.resolve(this.match(where) ?? null),
    findFirst: ({ where }: { where: Row }) => Promise.resolve(this.match(where) ?? null),
    findMany: ({ where }: { where: Row }) =>
      Promise.resolve(
        this.sessions
          .filter((s) => this.matches(s, where))
          .sort((a, b) => (b["createdAt"] as Date).getTime() - (a["createdAt"] as Date).getTime()),
      ),
    updateMany: ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const s of this.sessions) {
        if (this.matches(s, where)) {
          Object.assign(s, data);
          count += 1;
        }
      }
      return Promise.resolve({ count });
    },
  };

  $transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({ session: this.session, profile: this.profile, $queryRaw: this.queryRaw });

  private match(where: Row): Row | undefined {
    return this.sessions.find((s) => this.matches(s, where));
  }

  private matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([k, v]) =>
      k === "revokedAt" && v === null ? row["revokedAt"] === null : row[k] === v,
    );
  }
}

function make(): { repo: AuthRepository; db: FakePrisma } {
  const db = new FakePrisma();
  return { repo: new AuthRepository(db as unknown as PrismaClient), db };
}

const newSession = (over: Partial<Row> = {}) => ({
  id: "sess-1",
  userId: USER,
  companyId: null,
  familyId: "fam-1",
  refreshTokenHash: "hash-1",
  userAgent: "ua",
  ipAddress: "127.0.0.1",
  expiresAt: new Date(Date.now() + 86400_000),
  ...over,
});

describe("AuthRepository — profiles", () => {
  it("creates and finds a profile by email", async () => {
    const { repo } = make();
    const created = await repo.createProfile({
      email: "a@test.dev",
      passwordHash: "scrypt$...",
      fullName: "A",
      phoneEncrypted: null,
    });
    expect(created.email).toBe("a@test.dev");
    const found = await repo.findProfileByEmail("a@test.dev");
    expect(found?.id).toBe(created.id);
    expect(await repo.findProfileByEmail("nobody@test.dev")).toBeNull();
  });

  it("maps a unique-violation to EmailAlreadyExistsError", async () => {
    const { repo } = make();
    const input = {
      email: "dup@test.dev",
      passwordHash: "h",
      fullName: null,
      phoneEncrypted: null,
    };
    await repo.createProfile(input);
    await expect(repo.createProfile(input)).rejects.toBeInstanceOf(EmailAlreadyExistsError);
  });

  it("rethrows unrelated database errors", async () => {
    const { repo, db } = make();
    db.profile.create = () => Promise.reject(new Error("connection reset"));
    await expect(
      repo.createProfile({
        email: "x@test.dev",
        passwordHash: "h",
        fullName: null,
        phoneEncrypted: null,
      }),
    ).rejects.toThrow("connection reset");
  });
});

describe("AuthRepository — sessions", () => {
  it("creates, finds by hash, and lists sessions", async () => {
    const { repo } = make();
    await repo.createSession(newSession());
    expect((await repo.findSessionByRefreshHash("hash-1"))?.id).toBe("sess-1");
    expect(await repo.findSessionByRefreshHash("missing")).toBeNull();
    const list = await repo.listOwnSessions(USER);
    expect(list).toHaveLength(1);
  });

  it("rotates only when the presented hash is still current", async () => {
    const { repo } = make();
    await repo.createSession(newSession());
    const rotated = await repo.rotateSession({
      sessionId: "sess-1",
      expectedHash: "hash-1",
      newRefreshTokenHash: "hash-2",
      newExpiresAt: new Date(Date.now() + 86400_000),
    });
    expect(rotated?.refreshTokenHash).toBe("hash-2");
    // The old hash is no longer current → a second rotation with it is refused.
    const again = await repo.rotateSession({
      sessionId: "sess-1",
      expectedHash: "hash-1",
      newRefreshTokenHash: "hash-3",
      newExpiresAt: new Date(),
    });
    expect(again).toBeNull();
  });

  it("revokes a whole family", async () => {
    const { repo, db } = make();
    await repo.createSession(newSession({ id: "s1" }));
    await repo.createSession(newSession({ id: "s2", refreshTokenHash: "hash-2" }));
    await repo.revokeFamily("fam-1");
    expect(db.sessions.every((s) => s["revokedAt"] !== null)).toBe(true);
  });

  it("finds and revokes only the caller's own session (binding the principal)", async () => {
    const { repo, db } = make();
    await repo.createSession(newSession());
    expect((await repo.findOwnSessionById(USER, "sess-1"))?.id).toBe("sess-1");
    expect(await repo.findOwnSessionById(USER, "other")).toBeNull();
    await repo.revokeOwnSession(USER, "sess-1");
    expect(db.sessions[0]?.["revokedAt"]).not.toBeNull();
    // Each self-service op bound the user context via set_config.
    expect(db.queryRaw).toHaveBeenCalled();
  });

  it("rebinds a live session to a company and rotates its refresh token", async () => {
    const { repo, db } = make();
    await repo.createSession(newSession());
    const bound = await repo.bindSessionCompany({
      sessionId: "sess-1",
      userId: USER,
      companyId: "9f1c8f00-0000-4000-8000-000000000001",
      newFamilyId: "fam-2",
      newRefreshTokenHash: "hash-2",
      newExpiresAt: new Date(Date.now() + 86400_000),
    });
    expect(bound?.companyId).toBe("9f1c8f00-0000-4000-8000-000000000001");
    expect(bound?.familyId).toBe("fam-2");
    expect(bound?.refreshTokenHash).toBe("hash-2");
    expect(db.queryRaw).toHaveBeenCalled();
  });

  it("does not rebind a revoked session", async () => {
    const { repo, db } = make();
    await repo.createSession(newSession());
    (db.sessions[0] as Row)["revokedAt"] = new Date();
    const bound = await repo.bindSessionCompany({
      sessionId: "sess-1",
      userId: USER,
      companyId: "9f1c8f00-0000-4000-8000-000000000001",
      newFamilyId: "fam-2",
      newRefreshTokenHash: "hash-2",
      newExpiresAt: new Date(Date.now() + 86400_000),
    });
    expect(bound).toBeNull();
  });
});

describe("AuthRepository — profile & 2FA", () => {
  it("finds the caller's own profile, then stores and enables a TOTP secret", async () => {
    const { repo, db } = make();
    // Seed with a UUID id; setUserContext validates the principal is a UUID.
    db.profiles.push({
      id: USER,
      email: "2fa@test.dev",
      passwordHash: "h",
      fullName: null,
      phoneEncrypted: null,
      totpSecretEncrypted: null,
      totpEnabledAt: null,
      createdAt: new Date(),
    });

    expect((await repo.findOwnProfileById(USER))?.email).toBe("2fa@test.dev");
    expect(await repo.findOwnProfileById("00000000-0000-4000-8000-000000000000")).toBeNull();

    await repo.setTotpSecret(USER, "enc-secret");
    expect(db.profiles[0]?.["totpSecretEncrypted"]).toBe("enc-secret");
    expect(db.profiles[0]?.["totpEnabledAt"]).toBeNull();

    const enabledAt = new Date();
    await repo.enableTotp(USER, enabledAt);
    expect(db.profiles[0]?.["totpEnabledAt"]).toBe(enabledAt);
    expect(db.queryRaw).toHaveBeenCalled();
  });
});
