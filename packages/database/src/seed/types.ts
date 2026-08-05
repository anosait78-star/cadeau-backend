import type { SqlExecutor } from "../types";

/** Which seed set produced a report. */
export type SeedKind = "system" | "dev";

/** Outcome of a single seeder. */
export interface SeederResult {
  /** Rows created or updated. `0` means everything was already in place. */
  readonly changed: number;
}

/**
 * One idempotent unit of seed data. `run` MUST be safe to execute repeatedly
 * (upsert semantics): running it against an already-seeded database performs no
 * net change and reports `changed: 0`. Seeders receive the surrounding
 * transaction, so a failure in any seeder rolls back the whole run.
 */
export interface Seeder {
  readonly name: string;
  run(tx: SqlExecutor): Promise<SeederResult>;
}

/** Per-seeder line item in a {@link SeedReport}. */
export interface SeederReportEntry {
  readonly name: string;
  readonly changed: number;
}

/** Summary of a completed seed run. */
export interface SeedReport {
  readonly kind: SeedKind;
  readonly seeders: readonly SeederReportEntry[];
  readonly totalChanged: number;
  readonly durationMs: number;
}
