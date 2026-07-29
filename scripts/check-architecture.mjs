#!/usr/bin/env node
/**
 * Architecture tests runner.
 *
 * Runs dependency-cruiser against the workspace source roots that actually
 * exist, so the check is valid *before* the first NestJS app is scaffolded and
 * automatically widens to cover `apps/` the moment M1.5 creates it — no edit to
 * this script or to CI required.
 *
 * The rules themselves live in `.dependency-cruiser.cjs`. This wrapper only
 * decides the scan scope and forwards the process exit code, matching the
 * pattern of `scripts/check-stable-only.mjs`.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Candidate source roots, in dependency order. Only existing ones are scanned;
// dependency-cruiser errors on a non-existent path, so we filter first.
const candidateRoots = ["packages", "apps"];
const roots = candidateRoots.filter((dir) => existsSync(join(root, dir)));

if (roots.length === 0) {
  console.error("[architecture] No source roots found (packages/, apps/). Nothing to check.");
  process.exit(0);
}

// Resolve the dependency-cruiser CLI entry point so we don't depend on PATH or
// the platform-specific .bin shim. The package's `bin/` is not exposed through
// its `exports` map, so we derive the package root from its main entry (which is
// exported) and build the bin path from there.
const marker = "/dependency-cruiser/";
const mainUrl = import.meta.resolve("dependency-cruiser");
const pkgRootUrl = mainUrl.slice(0, mainUrl.indexOf(marker) + marker.length);
const depcruiseBin = fileURLToPath(pkgRootUrl + "bin/dependency-cruise.mjs");

const args = [
  depcruiseBin,
  "--config",
  join(root, ".dependency-cruiser.cjs"),
  "--output-type",
  "err", // print only violations; exit non-zero on any error-severity rule
  ...roots,
];

console.error(`[architecture] Cruising: ${roots.join(", ")}`);

const result = spawnSync(process.execPath, args, {
  cwd: root,
  stdio: "inherit",
});

if (result.error) {
  console.error(`[architecture] Failed to run dependency-cruiser: ${result.error.message}`);
  process.exit(1);
}

if (result.status === 0) {
  console.error("[architecture] OK — no architecture violations found.");
}

process.exit(result.status ?? 1);
