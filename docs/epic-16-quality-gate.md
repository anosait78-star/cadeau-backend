# EPIC-16 Quality Gate (§2.5) — Part 1: Web Shared UI Infrastructure

**Epic:** EPIC-16 ("Launch Gate", execution-plan.md §EPIC-16) · **Branch:**
`feat/epic-15-notifications` · **Gate run:** 2026-08-02.

**This covers Part 1 of EPIC-16 only.** The epic's full roadmap definition
is: _"Every Empty/Loading/Error state · full localization + real RTL · perf
P95<2s + keyset everywhere · WCAG AA · penetration test · pre-deployment
security checklist · verify all launch gates."_ This gate run closes the
shared-UI-infrastructure migration plus the Empty/Loading/Error-state and
RTL consistency work across every module — it does **not** cover a formal
WCAG AA audit, a penetration test, a pre-deployment security checklist, or
P95 latency verification. **EPIC-16 remains open** until a Part 2 gate
covers those remaining items.

The mandatory post-epic quality gate dimensions verified in this run:
Security · Architecture · Code · Testing · Performance · UI/Accessibility ·
Documentation · Extensibility · AI-out — plus **owner approval**.

**Scope note:** EPIC-16 is a frontend-only effort (`apps/web`) — it built a
shared UI infrastructure (`DataGrid`/`MobileCardList`, `DetailPanel`,
`ConfirmDialog`, `StatusBadge`, `TableToolbar`, `FilterBar`, `SavedViews`,
`Toast`) and migrated every existing module onto it. It introduced **no new
backend module, no new migration, and no new API route**. Several unrelated
backend/frontend feature commits (Bosta carrier integration, company
onboarding, change-password/account-deletion, CSV import) landed on the same
branch in the same working session but are **separate, already-reviewed
work items, not part of this epic** — they are excluded from this gate's
scope and numbers below, except where noted (the full-branch gate run
necessarily includes them, since gates run against the whole tree).

---

## 0. Gate summary

| Dimension          | Result  | Note                                                                                                                                                                               |
| ------------------ | :-----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security           | ✅ PASS | No new attack surface — same routes/permissions, presentation-layer only; no secrets/PII touched                                                                                   |
| Architecture       | ✅ PASS | [epic-16-phase-a-review.md](epic-16-phase-a-review.md) (build) + [epic-16-phase-c-review.md](epic-16-phase-c-review.md) (final) — 0 layering violations, generic shared components |
| Code               | ✅ PASS | No dead code, no TODOs, consistent naming (1 minor outlier), good comment hygiene — see Phase C review                                                                             |
| Testing            | ✅ PASS | Full monorepo `pnpm test` green from a cold cache against real Postgres; web +137 tests over the EPIC-15 baseline                                                                  |
| Performance        | ✅ PASS | Web bundle 193.6 KB / 200 KB gzip (tight margin — see §5)                                                                                                                          |
| UI / Accessibility | ✅ PASS | RTL: 0 hardcoded physical-direction classes across 9 modules (exhaustive grep). A11y: consistent `Label htmlFor`/`aria-label`, 1 minor stylistic outlier                           |
| Documentation      | ✅ PASS | Phase A/B/C reviews, this gate doc, execution-plan/project-metrics/domain-map refreshed                                                                                            |
| Extensibility      | ✅ PASS | Every shared component is generic (`<T>` or fully data-driven); `FilterBar`/`SavedViews` still single-consumer each — flagged, not blocking                                        |
| AI-out (ADR-0004)  | ✅ PASS | No AI dependency introduced; `no-ai-imports` guard unaffected (frontend-only epic)                                                                                                 |

**Local gates (this run, cold cache):**

- `format:check` ✅ (1 pre-existing formatting issue found and fixed)
- `lint` ✅ clean
- `type-check` ✅ 8/8 packages
- `test` ✅ **1806 tests / 212 test files** — config 46 · crypto 47 ·
  database 71 · api 1305 · web 337 (up from 1602 at EPIC-15 close: config 46
  · crypto 47 · database 71 · api 1238 · web 200). Web coverage gate
  initially failed (functions 74.53%<75%, branches 68%<70%) on
  under-tested `*-columns.tsx` files from this epic's migration pattern;
  closed by adding direct unit tests for all 10 affected files — final web
  coverage 82.76% stmts / 71.52% branch / 80.42% funcs / 84.66% lines.
- `build` ✅ 5/5 packages
- `perf:bundle` ✅ `@cadeau/web` 193.6 KB / 200 KB gzip
- `arch:check` ✅ 761 modules, 2197 deps, **0 violations** — one violation
  was found and fixed during this gate run (`ShippingService`, part of the
  unrelated Bosta commit on this branch, imported infrastructure directly;
  fixed via new `BostaHttpClientPort`/`BostaCatalogCachePort`, not an
  EPIC-16 file, noted here for completeness of the cold-cache run)
- `node scripts/check-stable-only.mjs` ✅ no pre-release dependencies
- `pnpm audit --audit-level high` ✅ 0 high/critical (1 pre-existing
  moderate, unchanged)
- `database` gate ✅ 21 migrations applied and up to date against a real
  local Postgres (`docker compose up -d db`); `@cadeau/database`'s 71
  RLS/tenancy integration tests pass against the live database; full
  monorepo suite re-verified live end-to-end

**CI-only gates:** `e2e` (Playwright desktop+mobile + axe), `performance`
(Lighthouse), `api-load` (k6), `sast`, secret-scan — not attempted locally
(no browser/k6 harness in this session), run on push/PR to `main`.

---

## 1. Security

Presentation-layer-only epic — no new routes, no new permission keys, no new
data access. Every migrated page continues to call the same
`features/*-api.ts` functions and enforce the same `PermissionGate`/
capability checks as before migration; the shared components (`DataGrid`,
`DetailPanel`, etc.) take fully caller-supplied data and render it, they
never fetch or mutate on their own. No secrets, credentials, or PII were
introduced or touched by any EPIC-16 commit.

## 2. Architecture

See [epic-16-phase-a-review.md](epic-16-phase-a-review.md) for the initial
shared-component build (three fixes landed there: async-aware
`ConfirmDialog`, single-section `DetailPanel`, deduplicated Products JSX)
and [epic-16-phase-c-review.md](epic-16-phase-c-review.md) for the final
review across all ~10 migrated modules: genericity confirmed (no leftover
module-specific assumptions in shared components), consumer usage
consistent (`useIsDesktop()` + grid/card split everywhere it structurally
applies), no inverted `components/`→`pages/` dependencies, no cross-page
imports. Two items carried forward as non-blocking follow-up debt:
`FilterBar`/`SavedViews` still single-consumer each, and one multi-line
Toast message (pre-existing, Orders) that strains the fixed auto-dismiss
window.

The one real `arch:check` violation caught during this gate run
(`layer-application-no-outer` on `ShippingService` → Bosta infrastructure)
belongs to the unrelated Bosta-carrier commit that landed on this branch in
the same session, not to any EPIC-16 file — fixed the same way EPIC-15's
build-time violation was (a proper port + DI-token pair), recorded here
because it was caught while running this epic's cold-cache gate.

## 3. Code

Per [epic-16-phase-c-review.md](epic-16-phase-c-review.md): no dead code
(every migration replaced bespoke list-rendering in place, nothing orphaned),
no TODO/FIXME/XXX/HACK markers anywhere in the diff, consistent
`build<Entity>Columns` naming (11 of 12 files; `master-data-columns.tsx`'s
`buildMdColumns` is a minor, non-blocking outlier), WHY-oriented comments
matching the project's stated style. One real duplication issue found:
`DASH`/`formatMoney`/`formatDate` are centralized for Finance's 8 tabs in
`finance-shared.tsx` but reimplemented per-module in Customers/Orders/
Products/Inventory/Master-Data instead of a genuinely shared `lib/format.ts`
— flagged as follow-up debt, not fixed here per the "no refactors" scope
constraint for this gate run.

## 4. Testing

Full monorepo suite green from a cold cache, verified twice — once against
the Bosta/onboarding/change-password/CSV-import commits alone, once again
after Docker/Postgres came up, confirming the `database` gate and the rest
of the suite agree: **1806 tests total** (config 46, crypto 47, database 71,
api 1305, web 337), up from **1602** at EPIC-15 close. The web delta (+137)
includes this epic's coverage-gate-closing commit (10 new `*-columns.test.tsx`
files, direct render/sort-comparator/edge-case coverage, not placeholder
tests — verified by spot-check in the Phase C code review) plus tests added
across the Phase B migration commits themselves and the unrelated onboarding/
settings work on this branch. The api delta (+67) is entirely from the
unrelated Bosta/change-password/CSV-import commits — EPIC-16 touches no
`apps/api` file. `@cadeau/database`'s 71 tests (100% coverage) run as real
integration tests against a live local Postgres container and pass,
confirming the `database` gate is genuinely exercised, not skipped.

## 5. Performance

Web bundle: **193.6 KB / 200 KB gzip** (96.8% of budget) — tighter than
EPIC-15's close (172.0 KB). The shared infrastructure itself
(`DataGrid`/`MobileCardList`/`DetailPanel`/etc.) is reused across ~10
modules rather than duplicated, which is the mechanism keeping the
per-module marginal cost low, but the cumulative effect of onboarding four
new pages (Onboarding wizard) and a full Settings module inside the same
build makes the remaining headroom (~6.4 KB) worth watching before the next
epic adds a new page. Flagged for awareness, not a gate failure.

## 6. Deviations (recorded, not blockers)

- Finance **Periods** and **Reports** tabs deliberately kept their
  pre-migration `Card`-based layout rather than adopting `DataGrid`/
  `MobileCardList` — both are dashboard-style (no tabular record list),
  reviewed individually during Phase B, and Reports received an explicit
  after-the-fact compliance audit (`2dfdeba`) confirming Toast/loading-state
  usage is consistent with the grid-based tabs even though DataGrid itself
  doesn't apply.
- `FilterBar` and `SavedViews` remain single-consumer (Inventory and Orders
  respectively) after the full rollout — their APIs are exercised by real
  usage but not yet validated against a second, independent caller. Not a
  regression from Phase A; the risk Phase A named is simply still open.
- The `DASH`/`formatMoney`/`formatDate` duplication (§3) and the
  `orders-page.tsx` multi-line-toast edge case (§2) are both real,
  documented, and deliberately left as follow-up work rather than folded
  into this gate-closing pass, consistent with the instruction to fix only
  what the gate itself requires.

---

## 7. Owner approval

> **Status:** ⏳ **Pending.** Every technical dimension above is verified
> PASS against actual local gate output (cold cache, re-run against a live
> database), not asserted from memory. This approval, if granted, closes
> **Part 1 of EPIC-16 only** — the epic itself stays open pending Part 2
> (WCAG AA audit, penetration test, security checklist, P95 verification).
> Owner sign-off is a separate, explicit checkpoint.

| Reviewer | Role  | Decision | Date |
| -------- | ----- | -------- | ---- |
| Owner    | Owner | —        | —    |
