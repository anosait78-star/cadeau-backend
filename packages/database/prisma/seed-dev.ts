/**
 * Development seed entrypoint — run by `pnpm db:seed:dev` (via tsx). Applies
 * throwaway sample data for local development and tests. Refuses to run when
 * NODE_ENV=production.
 *
 * At M1.4 the dev seeder registry is empty by design.
 */
import { getConfig } from "@cadeau/config";
import { disconnectPrisma, getPrismaClient, runDevSeed } from "../src/index";
import type { SeedEnv } from "../src/index";

async function main(): Promise<void> {
  const env = getConfig().env as SeedEnv;
  const client = getPrismaClient();
  try {
    const report = await runDevSeed(client, env);
    console.info(
      `[seed:dev] ${report.seeders.length} seeder(s), ${report.totalChanged} change(s) in ${report.durationMs}ms`,
    );
  } finally {
    await disconnectPrisma();
  }
}

main().catch((error: unknown) => {
  console.error("[seed:dev] failed:", error);
  process.exitCode = 1;
});
