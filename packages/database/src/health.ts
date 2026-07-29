import type { HealthProbe } from "./types";

export interface DatabaseHealth {
  /** `"up"` when the probe query succeeded, `"down"` otherwise. */
  readonly status: "up" | "down";
  /** Round-trip time of the probe query in milliseconds (1-decimal). */
  readonly latencyMs: number;
  /** Present only when `status` is `"down"`: the failure message. */
  readonly error?: string;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Probe database connectivity with a trivial `SELECT 1`. Never throws: a
 * failure is reported as `status: "down"` with the error message and measured
 * latency, so callers (e.g. the BFF health endpoint in M1.5) can surface it
 * without special-casing exceptions.
 */
export async function checkDatabaseHealth(client: HealthProbe): Promise<DatabaseHealth> {
  const start = performance.now();
  try {
    await client.$queryRaw`SELECT 1`;
    return { status: "up", latencyMs: roundMs(performance.now() - start) };
  } catch (error) {
    return {
      status: "down",
      latencyMs: roundMs(performance.now() - start),
      error: toMessage(error),
    };
  }
}
