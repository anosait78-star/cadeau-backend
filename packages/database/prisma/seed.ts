/**
 * System seed entrypoint — run by `prisma db seed` (and in CI after
 * `migrate deploy`). Applies the idempotent system seed, so it is safe to run
 * on every deploy in every environment.
 *
 * At M1.4 the system seeder registry is empty by design, so this performs no
 * changes; it exists to prove the seed pipeline end-to-end.
 */
import { disconnectPrisma, getPrismaClient, runSystemSeed } from "../src/index";

async function main(): Promise<void> {
  const client = getPrismaClient();
  try {
    const report = await runSystemSeed(client);
    console.info(
      `[seed:system] ${report.seeders.length} seeder(s), ${report.totalChanged} change(s) in ${report.durationMs}ms`,
    );
  } finally {
    await disconnectPrisma();
  }
}

main().catch((error: unknown) => {
  console.error("[seed:system] failed:", error);
  process.exitCode = 1;
});
