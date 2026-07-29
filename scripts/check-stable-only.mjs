#!/usr/bin/env node
/**
 * ADR-001 gate: fail if any resolved dependency is a pre-release
 * (alpha / beta / rc / next / canary / any semver pre-release segment).
 *
 * Parses `pnpm-lock.yaml` as text and inspects every `name@version` identifier
 * under the resolved-package sections. A version is rejected when its semver
 * core (major.minor.patch) is followed by a `-<prerelease>` segment.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lockfilePath = join(root, "pnpm-lock.yaml");

let lockfile;
try {
  lockfile = readFileSync(lockfilePath, "utf8");
} catch {
  console.error(`[stable-only] Cannot read ${lockfilePath}. Run \`pnpm install\` first.`);
  process.exit(1);
}

// Capture the version that immediately follows a package name's "@".
// Scoped names (@scope/name) are safe: the "@scope" segment has no leading digit.
const identifierPattern = /@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g;
const prereleaseCore = /^\d+\.\d+\.\d+-/;

// Narrow, documented exemption: some official STABLE packages pin an internal
// binary with a version whose pre-release segment is a build counter + commit
// SHA rather than an unstable channel. The canonical case is Prisma's
// `@prisma/engines-version` (e.g. `7.1.1-3.c2990dca591cba766e3b7ef5d9e8a84796e47ab7`),
// which pins the query-engine binary and is a stable release. Real unstable
// channels (`-alpha`/`-beta`/`-rc`/`-next`/`-canary`/`-dev`) never take the
// `-<int>.<hex-commit>` shape, so this cannot mask an actual pre-release.
const STABLE_ENGINE_PIN = /^\d+\.\d+\.\d+-\d+\.[0-9a-f]{7,40}$/;

const offenders = new Set();
for (const match of lockfile.matchAll(identifierPattern)) {
  const version = match[1];
  if (prereleaseCore.test(version) && !STABLE_ENGINE_PIN.test(version)) {
    offenders.add(version);
  }
}

if (offenders.size > 0) {
  console.error("[stable-only] ADR-001 violation: pre-release dependencies detected:");
  for (const version of [...offenders].sort()) {
    console.error(`  - ${version}`);
  }
  console.error("Only Stable releases are allowed in the dependency tree.");
  process.exit(1);
}

console.error("[stable-only] OK — no pre-release (alpha/beta/rc/next/canary) dependencies found.");
process.exit(0);
