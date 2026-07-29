// Public surface of @cadeau/database — the database infrastructure layer.

// Client lifecycle
export { createPrismaClient, getPrismaClient, disconnectPrisma, toPrismaLogLevels } from "./client";
export type { CreatePrismaClientOptions, AppLogLevel, PrismaLogLevel } from "./client";

// Health
export { checkDatabaseHealth } from "./health";
export type { DatabaseHealth } from "./health";

// Multi-tenant RLS context
export { TENANT_GUC, isCompanyId, assertCompanyId, setTenantContext } from "./tenant-context";

// Transactions
export { withTransaction, withTenantTransaction } from "./transaction";

// Seed framework
export { runSeeders } from "./seed/run";
export { SYSTEM_SEEDERS, runSystemSeed } from "./seed/system-seed";
export { DEV_SEEDERS, assertNotProduction, runDevSeed } from "./seed/dev-seed";
export type { SeedEnv } from "./seed/dev-seed";
export type { Seeder, SeederResult, SeederReportEntry, SeedReport, SeedKind } from "./seed/types";

// Keyset (cursor) pagination
export { clampLimit, encodeCursor, decodeCursor, buildKeysetPage } from "./keyset";
export type { CursorValues, KeysetLimitOptions, KeysetPage } from "./keyset";

// Tenant-scoping repository helpers
export { scopedWhere, stampForCreate, stampForUpdate } from "./repository";
export type { TenantActor } from "./repository";

// Errors
export {
  DatabaseError,
  InvalidCompanyIdError,
  DevSeedInProductionError,
  InvalidCursorError,
} from "./errors";

// Structural client types
export type { SqlExecutor, TransactionRunner, HealthProbe } from "./types";

// Re-export the generated Prisma client namespace for consumers.
export { PrismaClient, Prisma } from "@prisma/client";
