# Performance Budget & Testing (M1.7)

The performance budget from Roadmap §2.4 is **enforced in CI as hard gates** — any
overage blocks the merge. The numbers only ever tighten, never loosen.

## Budget (§2.4)

| Metric                              | Budget                              | Gate                                     |
| ----------------------------------- | ----------------------------------- | ---------------------------------------- |
| Initial JS per route (gzip)         | **≤ 200 KB**                        | `pnpm perf:bundle` → `performance` job   |
| Lighthouse Performance              | **≥ 90**                            | Lighthouse CI → `performance` job        |
| Lighthouse Accessibility            | **≥ 90**                            | Lighthouse CI → `performance` job        |
| Screen load (P95) · LCP · CLS · TBT | < 2000ms · < 2.5s · < 0.1 · < 200ms | Lighthouse metrics                       |
| API server response (P95) — read    | **< 300ms**                         | k6 → `api-load` job                      |
| API server response (P95) — write   | **< 500ms**                         | k6 (added with write endpoints, EPIC-3+) |

## Gates

### Bundle size — `pnpm perf:bundle`

[`scripts/check-bundle-size.mjs`](../scripts/check-bundle-size.mjs) gzips the built
JS in `apps/web/dist/assets` and fails if the initial JS exceeds 200 KB gzip.
Self-contained (no external dependency). Current: ~99 KB gzip.

### Lighthouse CI — `pnpm exec lhci autorun`

Runs Lighthouse (`@lhci/cli`, pinned) against the built app (`staticDistDir`)
three times per form factor and asserts Performance/Accessibility ≥ 0.9 (errors)
and Best-Practices ≥ 0.9 (warn). Uses the CI runner's Chrome — no third-party action.

Both shells are gated (ADR-002): [`lighthouserc.json`](../lighthouserc.json)
(desktop form factor → **Desktop shell**) and
[`lighthouserc.mobile.json`](../lighthouserc.mobile.json) (mobile form factor →
**Mobile shell**).

### k6 API load — `k6 run perf/k6/health-smoke.js`

[`perf/k6/health-smoke.js`](../perf/k6/health-smoke.js) drives `/v1/health` and
gates on read **P95 < 300ms** and error rate < 1%. In CI k6 is installed from
Grafana's **GPG-signed APT repository** (verified packages — no unpinnable action
or guessed image digest, per ADR-001). Write-path load tests arrive with the
domain write endpoints.

## Testing

- **Unit / integration:** Vitest across all packages (`pnpm test`) — 127 tests.
  NestJS is transformed with SWC (decorator metadata); the web app uses Testing
  Library + jsdom.
- **E2E (both shells):** Playwright (`pnpm --filter @cadeau/web test:e2e`) runs two
  projects against the built app — **desktop** (≥1024px → Desktop shell) and
  **mobile** (Pixel 5 → Mobile shell). `smoke.spec.ts` runs on both;
  `desktop.spec.ts` (sidebar · ⌘K · toggles) and `mobile.spec.ts` (bottom nav ·
  FAB · More sheet) run per shell. Each shell also runs an **axe accessibility**
  check (`@axe-core/playwright`, no serious/critical violations) — the `e2e` job.

## CI jobs (this milestone)

`e2e` (Playwright smoke) · `performance` (bundle + Lighthouse) · `api-load` (k6) —
added to [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) alongside the
existing quality/security gates.
