import { describe, expect, it } from "vitest";
import type { SqlExecutor, TransactionRunner } from "../../types";
import { runSeeders } from "../run";
import { ACCESS_SEEDERS } from "./access-seeders";
import { FEATURES, PERMISSIONS, PLANS, TEMPLATES } from "./catalog";
import { createPlatformAdminsSeeder } from "./platform-admins-seeder";

/** A fake executor that records statements and returns a fixed affected count. */
function fakeExecutor(affectedPerStatement: number): SqlExecutor & { count: number } {
  return {
    count: 0,
    $executeRaw(_query: TemplateStringsArray, ..._values: unknown[]): Promise<number> {
      this.count += 1;
      return Promise.resolve(affectedPerStatement);
    },
    $queryRaw<T = unknown>(_query: TemplateStringsArray, ..._values: unknown[]): Promise<T> {
      return Promise.resolve([] as unknown as T);
    },
  };
}

function fakeRunner(executor: SqlExecutor): TransactionRunner {
  return {
    $transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      return fn(executor);
    },
  };
}

/** Number of upsert statements the catalog seeders issue in one run. */
const EXPECTED_STATEMENTS =
  FEATURES.length +
  PERMISSIONS.length +
  PERMISSIONS.filter((p) => p.feature !== null).length +
  PLANS.length +
  PLANS.reduce((sum, p) => sum + p.features.length, 0) +
  TEMPLATES.length +
  TEMPLATES.reduce((sum, t) => sum + t.permissions.length, 0);

describe("access catalog seeders", () => {
  it("issues one upsert per catalog row and sums the changes", async () => {
    const executor = fakeExecutor(1);
    const report = await runSeeders(fakeRunner(executor), "system", ACCESS_SEEDERS);
    expect(executor.count).toBe(EXPECTED_STATEMENTS);
    expect(report.totalChanged).toBe(EXPECTED_STATEMENTS);
  });

  it("reports zero changes on an already-seeded database (idempotent)", async () => {
    const executor = fakeExecutor(0);
    const report = await runSeeders(fakeRunner(executor), "system", ACCESS_SEEDERS);
    expect(executor.count).toBe(EXPECTED_STATEMENTS);
    expect(report.totalChanged).toBe(0);
  });
});

describe("platform admins seeder", () => {
  it("issues one grant statement per configured email", async () => {
    const executor = fakeExecutor(1);
    const seeder = createPlatformAdminsSeeder(["a@x.io", "b@x.io"]);
    const report = await runSeeders(fakeRunner(executor), "system", [seeder]);
    expect(executor.count).toBe(2);
    expect(report.totalChanged).toBe(2);
  });

  it("is a no-op when no emails are configured", async () => {
    const executor = fakeExecutor(1);
    const seeder = createPlatformAdminsSeeder([]);
    const report = await runSeeders(fakeRunner(executor), "system", [seeder]);
    expect(executor.count).toBe(0);
    expect(report.totalChanged).toBe(0);
  });
});
