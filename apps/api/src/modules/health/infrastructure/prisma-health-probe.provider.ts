import { type Provider } from "@nestjs/common";
import { getPrismaClient, type HealthProbe } from "@cadeau/database";

/** DI token for the Prisma-backed health probe (`SELECT 1` capable client). */
export const PRISMA_HEALTH_PROBE = Symbol("PRISMA_HEALTH_PROBE");

/**
 * Provides the process-wide Prisma client as a {@link HealthProbe}. Construction
 * is lazy — no connection is opened here — so a missing/unreachable database does
 * not prevent the app from booting; it surfaces as `readiness = degraded`.
 */
export const prismaHealthProbeProvider: Provider = {
  provide: PRISMA_HEALTH_PROBE,
  useFactory: (): HealthProbe => getPrismaClient(),
};
