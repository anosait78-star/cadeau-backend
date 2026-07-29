import { DevSeedInProductionError } from "../errors";
import type { TransactionRunner } from "../types";
import { runSeeders } from "./run";
import type { SeedReport, Seeder } from "./types";

/** A runtime environment name (mirrors `@cadeau/config` `NodeEnv`). */
export type SeedEnv = "development" | "test" | "staging" | "production";

/**
 * Registry of **dev** seeders — throwaway sample data for local development and
 * automated tests only. EMPTY at M1.4 by design; epics add their own fixtures
 * here. This data is forbidden in production (see {@link assertNotProduction}).
 */
export const DEV_SEEDERS: readonly Seeder[] = [];

/** Throw {@link DevSeedInProductionError} when `env` is production. */
export function assertNotProduction(env: SeedEnv): void {
  if (env === "production") {
    throw new DevSeedInProductionError();
  }
}

/**
 * Run the development seed after asserting the environment is not production.
 * Sample data is applied through the same atomic, idempotent engine as the
 * system seed.
 */
export async function runDevSeed(
  client: TransactionRunner,
  env: SeedEnv,
  seeders: readonly Seeder[] = DEV_SEEDERS,
): Promise<SeedReport> {
  assertNotProduction(env);
  return runSeeders(client, "dev", seeders);
}
