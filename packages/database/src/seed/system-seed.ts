import type { TransactionRunner } from "../types";
import { runSeeders } from "./run";
import type { SeedReport, Seeder } from "./types";

/**
 * Registry of **system** seeders — deterministic, idempotent reference data
 * that is part of the product and belongs in every environment (including
 * production).
 *
 * EMPTY at M1.4 by design. M1.4 delivers only the seed *framework*. The
 * reference data the roadmap lists (currencies, feature catalog, permission
 * templates, …) is registered here by the epic that owns it, never front-run.
 */
export const SYSTEM_SEEDERS: readonly Seeder[] = [];

/**
 * Run the system seed: apply every registered system seeder atomically and
 * idempotently. Safe to run on every deploy.
 */
export function runSystemSeed(
  client: TransactionRunner,
  seeders: readonly Seeder[] = SYSTEM_SEEDERS,
): Promise<SeedReport> {
  return runSeeders(client, "system", seeders);
}
