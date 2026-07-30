// Public surface of @cadeau/database — the database infrastructure layer.

// Client lifecycle
export { createPrismaClient, getPrismaClient, disconnectPrisma, toPrismaLogLevels } from "./client";
export type { CreatePrismaClientOptions, AppLogLevel, PrismaLogLevel } from "./client";

// Health
export { checkDatabaseHealth } from "./health";
export type { DatabaseHealth } from "./health";

// Multi-tenant RLS context
export { TENANT_GUC, isCompanyId, assertCompanyId, setTenantContext } from "./tenant-context";

// User (principal) RLS context — for user-owned tables (profiles, sessions)
export { USER_GUC, isUserId, assertUserId, setUserContext } from "./user-context";

// Transactions
export { withTransaction, withTenantTransaction, withUserTransaction } from "./transaction";

// Seed framework
export { runSeeders } from "./seed/run";
export { SYSTEM_SEEDERS, runSystemSeed } from "./seed/system-seed";
export { DEV_SEEDERS, assertNotProduction, runDevSeed } from "./seed/dev-seed";
export type { SeedEnv } from "./seed/dev-seed";
export type { Seeder, SeederResult, SeederReportEntry, SeedReport, SeedKind } from "./seed/types";

// Access catalog seed (EPIC-5)
export { ACCESS_SEEDERS } from "./seed/access/access-seeders";
export { createPlatformAdminsSeeder } from "./seed/access/platform-admins-seeder";
export {
  FEATURES,
  PERMISSIONS,
  PLANS,
  TEMPLATES,
  ALL_PERMISSION_KEYS,
} from "./seed/access/catalog";
export type { FeatureDef, PermissionDef, PlanDef, TemplateDef } from "./seed/access/catalog";

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
  InvalidUserIdError,
  DevSeedInProductionError,
  InvalidCursorError,
} from "./errors";

// Structural client types
export type { SqlExecutor, TransactionRunner, HealthProbe } from "./types";

// Re-export the generated Prisma client namespace for consumers.
export { PrismaClient, Prisma } from "@prisma/client";
