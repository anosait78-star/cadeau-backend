import { describe, expect, it, vi } from "vitest";
import { InvalidCompanyIdError } from "../errors";
import { withTenantTransaction, withTransaction } from "../transaction";
import type { SqlExecutor, TransactionRunner } from "../types";

const VALID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

interface QueryCall {
  readonly values: readonly unknown[];
}

function runnerWithRecording(calls: QueryCall[]): TransactionRunner {
  const tx: SqlExecutor = {
    $queryRaw: (_strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ values });
      return Promise.resolve([]);
    },
    $executeRaw: () => Promise.resolve(0),
  } as unknown as SqlExecutor;
  return {
    $transaction: (fn: (tx: SqlExecutor) => Promise<unknown>) => fn(tx),
  } as unknown as TransactionRunner;
}

describe("withTransaction", () => {
  it("runs the callback inside a transaction and returns its result", async () => {
    const runner = runnerWithRecording([]);
    const result = await withTransaction(runner, () => Promise.resolve(7));
    expect(result).toBe(7);
  });
});

describe("withTenantTransaction", () => {
  it("binds the tenant before running the callback and returns its result", async () => {
    const calls: QueryCall[] = [];
    const runner = runnerWithRecording(calls);
    const seen: string[] = [];
    const result = await withTenantTransaction(runner, VALID, async () => {
      seen.push("ran");
      return "ok";
    });
    expect(result).toBe("ok");
    // set_config bound the tenant exactly once, before the callback ran.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toEqual([VALID]);
    expect(seen).toEqual(["ran"]);
  });

  it("validates the tenant id before opening a transaction", async () => {
    const transaction = vi.fn();
    const runner = { $transaction: transaction } as unknown as TransactionRunner;
    await expect(
      withTenantTransaction(runner, "not-a-uuid", () => Promise.resolve(1)),
    ).rejects.toThrow(InvalidCompanyIdError);
    expect(transaction).not.toHaveBeenCalled();
  });
});
