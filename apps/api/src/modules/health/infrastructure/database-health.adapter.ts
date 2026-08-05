import { Inject, Injectable } from "@nestjs/common";
import { checkDatabaseHealth, type HealthProbe } from "@cadeau/database";
import type { DatabaseHealthPort } from "../domain/database-health.port";
import type { DependencyHealth } from "../domain/health.types";
import { PRISMA_HEALTH_PROBE } from "./prisma-health-probe.provider";

/**
 * Infrastructure adapter implementing {@link DatabaseHealthPort} via
 * `@cadeau/database`. This is the ONLY place in the health module that touches
 * the persistence layer (architecture test: `data-access-only-in-infrastructure`).
 */
@Injectable()
export class DatabaseHealthAdapter implements DatabaseHealthPort {
  constructor(@Inject(PRISMA_HEALTH_PROBE) private readonly probe: HealthProbe) {}

  check(): Promise<DependencyHealth> {
    // checkDatabaseHealth never throws: a failure is returned as status "down".
    return checkDatabaseHealth(this.probe);
  }
}
