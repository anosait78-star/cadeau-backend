import { describe, expect, it } from "vitest";
import { checkDatabaseHealth } from "../health";
import type { HealthProbe } from "../types";

function probe(result: () => Promise<unknown>): HealthProbe {
  return { $queryRaw: result } as unknown as HealthProbe;
}

describe("checkDatabaseHealth", () => {
  it("reports up with a numeric latency when the probe succeeds", async () => {
    const health = await checkDatabaseHealth(probe(() => Promise.resolve([{ ok: 1 }])));
    expect(health.status).toBe("up");
    expect(typeof health.latencyMs).toBe("number");
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    expect(health.error).toBeUndefined();
  });

  it("reports down with the Error message when the probe throws", async () => {
    const health = await checkDatabaseHealth(
      probe(() => Promise.reject(new Error("connection refused"))),
    );
    expect(health.status).toBe("down");
    expect(health.error).toBe("connection refused");
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("stringifies non-Error rejection values", async () => {
    const health = await checkDatabaseHealth(probe(() => Promise.reject("boom")));
    expect(health.status).toBe("down");
    expect(health.error).toBe("boom");
  });
});
