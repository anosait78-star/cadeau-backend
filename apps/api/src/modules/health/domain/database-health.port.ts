import type { DependencyHealth } from "./health.types";

/**
 * Port the application layer depends on to learn database health. The concrete
 * adapter lives in the infrastructure layer (backed by `@cadeau/database`), so
 * the inner layers never touch Prisma directly — enforced by the architecture
 * tests (`data-access-only-in-infrastructure`).
 */
export interface DatabaseHealthPort {
  check(): Promise<DependencyHealth>;
}

/** DI token for {@link DatabaseHealthPort}. */
export const DATABASE_HEALTH_PORT = Symbol("DATABASE_HEALTH_PORT");
