import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPrismaClient,
  disconnectPrisma,
  getPrismaClient,
  toPrismaLogLevels,
} from "../client";
import type { AppLogLevel, PrismaLogLevel } from "../client";

// Mock the config singleton so the getConfig() fallback paths are exercised
// without a real environment. Shape matches what client.ts reads.
vi.mock("@cadeau/config", () => ({
  getConfig: () => ({
    database: { url: "postgresql://user:pass@localhost:5432/cadeau_test" },
    logging: { level: "info" },
  }),
}));

const TEST_URL = "postgresql://user:pass@localhost:5432/cadeau_test";

afterEach(async () => {
  await disconnectPrisma();
});

describe("toPrismaLogLevels", () => {
  const cases: ReadonlyArray<readonly [AppLogLevel, PrismaLogLevel[]]> = [
    ["trace", ["query", "info", "warn", "error"]],
    ["debug", ["query", "info", "warn", "error"]],
    ["info", ["info", "warn", "error"]],
    ["warn", ["warn", "error"]],
    ["error", ["error"]],
    ["fatal", ["error"]],
  ];

  it.each(cases)("maps %s to the expected Prisma log levels", (level, expected) => {
    expect(toPrismaLogLevels(level)).toEqual(expected);
  });
});

describe("createPrismaClient", () => {
  it("constructs a client from explicit options without connecting", () => {
    const client = createPrismaClient({ url: TEST_URL, logLevel: "warn" });
    expect(typeof client.$disconnect).toBe("function");
  });

  it("falls back to @cadeau/config when options are omitted", () => {
    const client = createPrismaClient();
    expect(typeof client.$connect).toBe("function");
  });
});

describe("getPrismaClient / disconnectPrisma", () => {
  it("returns the same singleton until disconnected", async () => {
    const first = getPrismaClient({ url: TEST_URL, logLevel: "error" });
    const second = getPrismaClient();
    expect(second).toBe(first);

    await disconnectPrisma();

    const third = getPrismaClient({ url: TEST_URL, logLevel: "error" });
    expect(third).not.toBe(first);
  });

  it("is a no-op when there is no active singleton", async () => {
    await expect(disconnectPrisma()).resolves.toBeUndefined();
  });
});
