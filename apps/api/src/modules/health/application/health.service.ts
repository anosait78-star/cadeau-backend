import { Inject, Injectable } from "@nestjs/common";
import { DATABASE_HEALTH_PORT, type DatabaseHealthPort } from "../domain/database-health.port";
import type { LivenessReport, ReadinessReport } from "../domain/health.types";

/**
 * Composes the health reports. Liveness is dependency-free (the process is up).
 * Readiness aggregates dependency probes (currently the database) into an
 * overall verdict: `ok` when all are up, `degraded` when a probe is down.
 */
@Injectable()
export class HealthService {
  constructor(@Inject(DATABASE_HEALTH_PORT) private readonly database: DatabaseHealthPort) {}

  liveness(): LivenessReport {
    return { status: "ok", uptimeSeconds: this.uptimeSeconds() };
  }

  async readiness(): Promise<ReadinessReport> {
    const database = await this.database.check();
    return {
      status: database.status === "up" ? "ok" : "degraded",
      uptimeSeconds: this.uptimeSeconds(),
      dependencies: { database },
    };
  }

  private uptimeSeconds(): number {
    return Math.round(process.uptime());
  }
}
