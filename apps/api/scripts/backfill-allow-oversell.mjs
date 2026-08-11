#!/usr/bin/env node
/**
 * One-time backfill (2026-08-26): flip `allow_oversell` to true on every
 * existing product for one company.
 *
 * Why this exists: the oversell-policy default just changed from false to
 * true (products_allow_oversell_default_true migration) so new products let
 * an order through even at zero stock — but a Postgres column-default change
 * only affects rows inserted afterwards. Every product created before this
 * migration keeps its old `false` explicitly. This script applies the new
 * default to those existing rows; it never touches products already set to
 * `true`, and it never touches `false` set on purpose after this ran (it's
 * a one-shot data migration, not an ongoing policy — re-run only means
 * "catch up any rows still at the old default").
 *
 * Usage (on the server, from the cadeau-backend repo root):
 *   node apps/api/scripts/backfill-allow-oversell.mjs <companyId>
 */
import console from "node:console";
import process from "node:process";
import { PrismaClient } from "@cadeau/database";

async function main() {
  const companyId = process.argv[2];
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!companyId || !UUID_RE.test(companyId)) {
    console.error("Usage: node backfill-allow-oversell.mjs <companyId>");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT set_config('app.company_id', '${companyId}', true)`);

      const { count } = await tx.product.updateMany({
        where: { companyId, allowOversell: false },
        data: { allowOversell: true },
      });

      console.warn({ companyId, updated: count });
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
