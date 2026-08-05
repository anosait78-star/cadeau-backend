import { describe, expect, it, vi } from "vitest";
import { InvalidCompanyIdError } from "../errors";
import { assertCompanyId, isCompanyId, setTenantContext, TENANT_GUC } from "../tenant-context";
import type { SqlExecutor } from "../types";

const VALID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

interface QueryCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

function recordingExecutor(calls: QueryCall[]): SqlExecutor {
  return {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join("?"), values });
      return Promise.resolve([]);
    },
    $executeRaw: () => Promise.resolve(0),
  } as unknown as SqlExecutor;
}

describe("isCompanyId", () => {
  it("accepts a well-formed UUID", () => {
    expect(isCompanyId(VALID)).toBe(true);
  });

  it("rejects malformed strings and non-strings", () => {
    const bad: unknown[] = ["", "not-a-uuid", "3f2504e0", `${VALID} `, 123, null, undefined, {}];
    for (const value of bad) {
      expect(isCompanyId(value)).toBe(false);
    }
  });
});

describe("assertCompanyId", () => {
  it("does not throw for a valid UUID", () => {
    expect(() => assertCompanyId(VALID)).not.toThrow();
  });

  it("throws InvalidCompanyIdError quoting an offending string", () => {
    expect(() => assertCompanyId("bad'; DROP TABLE")).toThrow(InvalidCompanyIdError);
    expect(() => assertCompanyId("bad'; DROP TABLE")).toThrow(/"bad'; DROP TABLE"/);
  });

  it("describes the type for non-string values", () => {
    expect(() => assertCompanyId(42)).toThrow(/received number/);
  });
});

describe("setTenantContext", () => {
  it("binds the tenant via a parameterized set_config on the GUC", async () => {
    const calls: QueryCall[] = [];
    await setTenantContext(recordingExecutor(calls), VALID);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("set_config");
    expect(calls[0]?.sql).toContain(TENANT_GUC);
    // The company id is a bound parameter, never interpolated into the SQL.
    expect(calls[0]?.values).toEqual([VALID]);
    expect(calls[0]?.sql).not.toContain(VALID);
  });

  it("rejects an invalid tenant before issuing any query", async () => {
    const queryRaw = vi.fn();
    const tx = { $queryRaw: queryRaw, $executeRaw: vi.fn() } as unknown as SqlExecutor;
    await expect(setTenantContext(tx, "nope")).rejects.toThrow(InvalidCompanyIdError);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
