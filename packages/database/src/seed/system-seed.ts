import type { TransactionRunner } from "../types";
import { ACCESS_SEEDERS } from "./access/access-seeders";
import { MASTER_DATA_SEEDERS } from "./master-data/master-data-seeders";
import { runSeeders } from "./run";
import type { SeedReport, Seeder } from "./types";

/**
 * Registry of **system** seeders — deterministic, idempotent reference data
 * that is part of the product and belongs in every environment (including
 * production).
 *
 * EPIC-5 registers the access catalog here (features, permissions + feature
 * edges, plans, and the six permission templates). The platform Super-Admin
 * seeder is env-parameterized (`SUPER_ADMIN_EMAILS`) and appended by the seed
 * entrypoint, not listed here. EPIC-7 registers the master-data reference
 * catalog (currencies, country configs, governorates); later epics register
 * their reference data the same way, never front-run.
 */
export const SYSTEM_SEEDERS: readonly Seeder[] = [...ACCESS_SEEDERS, ...MASTER_DATA_SEEDERS];

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
