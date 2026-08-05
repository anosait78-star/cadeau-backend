import type { TransactionRunner } from "../types";
import type { SeedKind, SeedReport, Seeder, SeederReportEntry } from "./types";

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Execute a list of seeders atomically inside a single transaction and return a
 * report. Seeders run in array order; if any throws, the transaction rolls back
 * and no partial seed is committed. Because every seeder is idempotent, the
 * whole run is idempotent — running it twice leaves the database unchanged the
 * second time (`totalChanged: 0`).
 *
 * This is the engine shared by the system and dev seeds. At M1.4 both seeder
 * lists are empty by design; domain epics register their seeders here.
 */
export async function runSeeders(
  client: TransactionRunner,
  kind: SeedKind,
  seeders: readonly Seeder[],
): Promise<SeedReport> {
  const start = performance.now();
  const entries = await client.$transaction(async (tx) => {
    const collected: SeederReportEntry[] = [];
    for (const seeder of seeders) {
      const result = await seeder.run(tx);
      collected.push({ name: seeder.name, changed: result.changed });
    }
    return collected;
  });
  const totalChanged = entries.reduce((sum, entry) => sum + entry.changed, 0);
  return {
    kind,
    seeders: entries,
    totalChanged,
    durationMs: roundMs(performance.now() - start),
  };
}
