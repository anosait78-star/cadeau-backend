#!/usr/bin/env node
/**
 * Performance budget gate: initial JavaScript per app, gzipped (Roadmap §2.4).
 *
 * Budget: the initial JS a route ships must stay ≤ 200 KB gzip. Until
 * code-splitting introduces lazy chunks, "initial JS" is the sum of the built
 * entry chunks in `dist/assets`. Any overage blocks the merge (the numbers only
 * tighten, never loosen — §2.4).
 *
 * Run after `pnpm --filter @cadeau/web build`. Mirrors the self-contained style
 * of `scripts/check-stable-only.mjs` (no external dependencies).
 */
import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Apps to check, with their gzip budget (KB) for initial JS. */
const BUDGETS = [{ name: "@cadeau/web", distAssets: "apps/web/dist/assets", maxGzipKb: 200 }];

const KB = 1024;

function gzipKbOfJs(assetsDir) {
  const dir = join(root, assetsDir);
  if (!existsSync(dir)) {
    return {
      ok: false,
      reason: `missing ${assetsDir} — build the app first`,
      totalKb: 0,
      files: [],
    };
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => {
      const gz = gzipSync(readFileSync(join(dir, f))).length / KB;
      return { file: f, gzipKb: gz };
    })
    .sort((a, b) => b.gzipKb - a.gzipKb);
  const totalKb = files.reduce((sum, f) => sum + f.gzipKb, 0);
  return { ok: true, totalKb, files };
}

let failed = false;
for (const budget of BUDGETS) {
  const result = gzipKbOfJs(budget.distAssets);
  if (!result.ok) {
    console.error(`[bundle-size] ${budget.name}: ${result.reason}`);
    failed = true;
    continue;
  }
  const total = result.totalKb;
  const status = total <= budget.maxGzipKb ? "OK" : "OVER BUDGET";
  console.error(
    `[bundle-size] ${budget.name}: initial JS ${total.toFixed(1)} KB gzip ` +
      `/ budget ${budget.maxGzipKb} KB → ${status}`,
  );
  for (const f of result.files) {
    console.error(`  - ${f.file}: ${f.gzipKb.toFixed(1)} KB gzip`);
  }
  if (total > budget.maxGzipKb) failed = true;
}

if (failed) {
  console.error("[bundle-size] Performance budget exceeded (Roadmap §2.4).");
  process.exit(1);
}
console.error("[bundle-size] OK — all apps within the gzip budget.");
process.exit(0);
