import type { HealthProbe } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import { DatabaseHealthAdapter } from "./database-health.adapter";

/** A HealthProbe whose `$queryRaw` resolves or rejects on demand. */
function probe(behaviour: "ok" | "fail"): HealthProbe {
  return {
    $queryRaw:
      behaviour === "ok"
        ? vi.fn().mockResolvedValue([{ result: 1 }])
        : vi.fn().mockRejectedValue(new Error("connection refused")),
  } as unknown as HealthProbe;
}

describe("DatabaseHealthAdapter", () => {
  it("reports up when the probe query succeeds", async () => {
    const result = await new DatabaseHealthAdapter(probe("ok")).check();
    expect(result.status).toBe("up");
    expect(typeof result.latencyMs).toBe("number");
    expect(result.error).toBeUndefined();
  });

  it("reports down with the error message when the probe fails", async () => {
    const result = await new DatabaseHealthAdapter(probe("fail")).check();
    expect(result.status).toBe("down");
    expect(result.error).toBe("connection refused");
  });
});
