import { describe, expect, it, vi } from "vitest";
import type { DatabaseHealthPort } from "../domain/database-health.port";
import type { DependencyHealth } from "../domain/health.types";
import { HealthService } from "./health.service";

function serviceWith(dbHealth: DependencyHealth): HealthService {
  const port: DatabaseHealthPort = { check: vi.fn().mockResolvedValue(dbHealth) };
  return new HealthService(port);
}

describe("HealthService", () => {
  it("liveness reports ok with a numeric uptime", () => {
    const report = serviceWith({ status: "up", latencyMs: 1 }).liveness();
    expect(report.status).toBe("ok");
    expect(typeof report.uptimeSeconds).toBe("number");
  });

  it("readiness is ok when the database is up", async () => {
    const report = await serviceWith({ status: "up", latencyMs: 2.5 }).readiness();
    expect(report.status).toBe("ok");
    expect(report.dependencies.database).toEqual({ status: "up", latencyMs: 2.5 });
  });

  it("readiness is degraded when the database is down", async () => {
    const report = await serviceWith({
      status: "down",
      latencyMs: 5,
      error: "refused",
    }).readiness();
    expect(report.status).toBe("degraded");
    expect(report.dependencies.database.status).toBe("down");
  });
});
