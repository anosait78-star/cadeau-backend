/**
 * System seed entrypoint — run by `prisma db seed` (and in CI after
 * `migrate deploy`). Applies the idempotent system seed, so it is safe to run
 * on every deploy in every environment.
 *
 * At M1.4 the system seeder registry is empty by design, so this performs no
 * changes; it exists to prove the seed pipeline end-to-end.
 */
import { getConfig } from "@cadeau/config";
import {
  SYSTEM_SEEDERS,
  createPlatformAdminsSeeder,
  disconnectPrisma,
  getPrismaClient,
  runSystemSeed,
} from "../src/index";

async function main(): Promise<void> {
  const client = getPrismaClient();
  // The platform Super-Admin seeder is env-parameterized, so append it here to
  // the static system catalog. Empty SUPER_ADMIN_EMAILS ⇒ a no-op seeder.
  const seeders = [...SYSTEM_SEEDERS, createPlatformAdminsSeeder(getConfig().superAdminEmails)];
  try {
    const report = await runSystemSeed(client, seeders);
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
