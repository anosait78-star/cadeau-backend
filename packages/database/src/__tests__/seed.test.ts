import { describe, expect, it, vi } from "vitest";
import { DevSeedInProductionError } from "../errors";
import { assertNotProduction, runDevSeed } from "../seed/dev-seed";
import { runSeeders } from "../seed/run";
import { runSystemSeed } from "../seed/system-seed";
import type { Seeder } from "../seed/types";
import type { SqlExecutor, TransactionRunner } from "../types";

const VALID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** A runner whose $transaction invokes the callback with a no-op executor. */
function fakeRunner(): TransactionRunner {
  const tx = {
    $queryRaw: () => Promise.resolve([]),
    $executeRaw: () => Promise.resolve(0),
  } as unknown as SqlExecutor;
  return {
    $transaction: (fn: (tx: SqlExecutor) => Promise<unknown>) => fn(tx),
  } as unknown as TransactionRunner;
}

function seeder(name: string, changed: number, log?: string[]): Seeder {
  return {
    name,
    run: () => {
      log?.push(name);
      return Promise.resolve({ changed });
    },
  };
}

describe("runSeeders", () => {
  it("runs seeders in order and aggregates changes", async () => {
    const order: string[] = [];
    const report = await runSeeders(fakeRunner(), "system", [
      seeder("a", 2, order),
      seeder("b", 3, order),
    ]);
    expect(order).toEqual(["a", "b"]);
    expect(report.kind).toBe("system");
    expect(report.totalChanged).toBe(5);
    expect(report.seeders).toEqual([
      { name: "a", changed: 2 },
      { name: "b", changed: 3 },
    ]);
    expect(typeof report.durationMs).toBe("number");
  });

  it("is idempotent: a second run over already-applied seeders reports no change", async () => {
    // Stateful seeder: changes rows the first time, nothing the second time.
    let applied = false;
    const idempotent: Seeder = {
      name: "once",
      run: () => {
        const changed = applied ? 0 : 1;
        applied = true;
        return Promise.resolve({ changed });
      },
    };
    const first = await runSeeders(fakeRunner(), "system", [idempotent]);
    const second = await runSeeders(fakeRunner(), "system", [idempotent]);
    expect(first.totalChanged).toBe(1);
    expect(second.totalChanged).toBe(0);
  });

  it("propagates a seeder failure and skips later seeders (atomic run)", async () => {
    const order: string[] = [];
    const failing: Seeder = {
      name: "boom",
      run: () => {
        order.push("boom");
        return Promise.reject(new Error("seed failed"));
      },
    };
    await expect(
      runSeeders(fakeRunner(), "system", [seeder("a", 1, order), failing, seeder("c", 1, order)]),
    ).rejects.toThrow("seed failed");
    expect(order).toEqual(["a", "boom"]); // "c" never ran
  });
});

describe("runSystemSeed", () => {
  it("applies the registered access catalog seeders (EPIC-5)", async () => {
    // The fake executor reports 0 affected rows, so a catalog already in place
    // yields totalChanged 0 while still running every registered seeder.
    const report = await runSystemSeed(fakeRunner());
    expect(report.kind).toBe("system");
    expect(report.seeders.map((s) => s.name)).toEqual([
      "access:features",
      "access:permissions",
      "access:feature_permissions",
      "access:plans",
      "access:permission_templates",
    ]);
    expect(report.totalChanged).toBe(0);
  });
});

describe("assertNotProduction", () => {
  it("passes for non-production environments", () => {
    for (const env of ["development", "test", "staging"] as const) {
      expect(() => assertNotProduction(env)).not.toThrow();
    }
  });

  it("throws in production", () => {
    expect(() => assertNotProduction("production")).toThrow(DevSeedInProductionError);
  });
});

describe("runDevSeed", () => {
  it("refuses to run in production before opening a transaction", async () => {
    const transaction = vi.fn();
    const runner = { $transaction: transaction } as unknown as TransactionRunner;
    await expect(runDevSeed(runner, "production")).rejects.toThrow(DevSeedInProductionError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("runs in development and reports the dev kind", async () => {
    const report = await runDevSeed(fakeRunner(), "development");
    expect(report.kind).toBe("dev");
    expect(report.totalChanged).toBe(0);
  });

  it("passes tenant-shaped fixture ids through unchanged", async () => {
    const report = await runDevSeed(fakeRunner(), "test", [seeder(`tenant-${VALID}`, 0)]);
    expect(report.seeders[0]?.name).toBe(`tenant-${VALID}`);
  });
});
