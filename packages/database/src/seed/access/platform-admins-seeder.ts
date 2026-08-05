import type { SqlExecutor } from "../../types";
import type { Seeder, SeederResult } from "../types";

/**
 * Build the platform Super-Admin seeder for a set of emails (from
 * `SUPER_ADMIN_EMAILS`). Idempotent: each email is matched to a profile
 * (case-insensitive via citext) and granted a `platform_admins` row
 * `ON CONFLICT DO NOTHING`. An email with no matching profile yet is silently
 * skipped — re-running the seed after that user registers grants the row then.
 *
 * Parameterized (not a static member of {@link ACCESS_SEEDERS}) because the
 * emails come from configuration; the seed entrypoint appends it to the system
 * seed list. Runs in the null-principal seed context permitted by the
 * `platform_admins_seed` RLS policy.
 */
export function createPlatformAdminsSeeder(emails: readonly string[]): Seeder {
  return {
    name: "access:platform_admins",
    async run(tx: SqlExecutor): Promise<SeederResult> {
      let changed = 0;
      for (const email of emails) {
        changed += await tx.$executeRaw`
          INSERT INTO public.platform_admins (user_id)
          SELECT p.id FROM public.profiles p WHERE p.email = ${email}
          ON CONFLICT (user_id) DO NOTHING
        `;
      }
      return { changed };
    },
  };
}
