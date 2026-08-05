import { describe, expect, it } from "vitest";
import type { SqlExecutor, TransactionRunner } from "../../types";
import { runSeeders } from "../run";
import { COUNTRIES, CURRENCIES } from "./catalog";
import { MASTER_DATA_SEEDERS } from "./master-data-seeders";

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

/** Number of upsert statements the master-data seeders issue in one run. */
const EXPECTED_STATEMENTS =
  CURRENCIES.length +
  COUNTRIES.length +
  COUNTRIES.reduce((sum, c) => sum + c.governorates.length, 0);

describe("master-data catalog seeders", () => {
  it("issues one upsert per reference row and sums the changes", async () => {
    const executor = fakeExecutor(1);
    const report = await runSeeders(fakeRunner(executor), "system", MASTER_DATA_SEEDERS);
    expect(executor.count).toBe(EXPECTED_STATEMENTS);
    expect(report.totalChanged).toBe(EXPECTED_STATEMENTS);
  });

  it("reports zero changes on an already-seeded database (idempotent)", async () => {
    const executor = fakeExecutor(0);
    const report = await runSeeders(fakeRunner(executor), "system", MASTER_DATA_SEEDERS);
    expect(executor.count).toBe(EXPECTED_STATEMENTS);
    expect(report.totalChanged).toBe(0);
  });

  it("seeds Egypt with all 27 governorates", () => {
    const egypt = COUNTRIES.find((c) => c.code === "EG");
    expect(egypt?.governorates).toHaveLength(27);
  });

  it("every country references a currency present in the catalog", () => {
    const codes = new Set(CURRENCIES.map((c) => c.code));
    for (const country of COUNTRIES) {
      expect(codes.has(country.currency)).toBe(true);
    }
  });
});
