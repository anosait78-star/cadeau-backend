# EPIC-16 Phase C — final architecture/code/UI review (Part 1)

Reviewed after all 8 Finance sub-tabs (Phase B) were migrated and the Finance
Reports tab received its explicit compliance audit. This is the final review
of **Part 1 of EPIC-16** — the shared-UI-infrastructure migration and its
RTL/empty-state/accessibility consistency pass — not the whole epic. EPIC-16's
full roadmap scope (execution-plan.md §EPIC-16, "Launch Gate") additionally
requires a WCAG AA audit, a penetration test, a pre-deployment security
checklist, and P95 performance verification, none of which this review
covers; see [epic-16-quality-gate.md](epic-16-quality-gate.md) for the
Part-1/Part-2 split. See [epic-16-phase-a-review.md](epic-16-phase-a-review.md)
for the Phase A shared-infrastructure build/pilot review.

## Scope

Every module now on the shared UI infrastructure (`apps/web/src/components/`:
`DataGrid`/`MobileCardList`, `DetailPanel`, `ConfirmDialog`, `StatusBadge`,
`TableToolbar`, `FilterBar`, `SavedViews`, `Toast`):

Orders (reference implementation, Phase A) · Products · Customers · Inventory
(stock + warehouses) · Master Data · Finance (shell + Suppliers, Purchase
Orders, Expenses, Invoices, Refunds, Reconciliations, Periods, Reports) ·
Analytics · Settings/Notifications · Onboarding.

## Architecture review

**Genericity** — grepped every shared component for leftover module-specific
assumptions (hardcoded domain strings, status values, routes). None found;
`StatusBadge`/`DetailPanel`/`ConfirmDialog` remain fully data-driven.

**Consumer consistency** — all grid-based modules (Customers, Products,
Inventory, Master Data, Orders, and 6 of 8 Finance tabs) use the same
`useIsDesktop()` → `DataGrid`/`MobileCardList` split. The two exceptions
(Finance Periods and Reports) are deliberate, dashboard-style tabs with no
tabular record list, already documented in-code and reviewed individually
during Phase B.

**`FilterBar`/`SavedViews` adoption** — after the full migration, each still
has exactly **one** production consumer (`FilterBar` in Inventory only,
`SavedViews` in Orders only). Phase A flagged these as unvalidated; that risk
is only partially retired — the API has survived one real integration each,
not a second one that would surface a shape mismatch. **Not a blocker**, but
tracked as open debt below.

**`DetailPanel` single- vs multi-section** — the Phase A fix
(`sections.length === 1` skips the tab strip) still holds. Every consumer
except Orders passes exactly one section; Orders (8 sections) remains the
only exerciser of the multi-section tab-strip path.

**Toast** — consistent `flash(text)` usage everywhere, all short single-line
messages, except `apps/web/src/pages/orders/orders-page.tsx:916-935`
(stock-shortage error), which can build a 3+ line message against the fixed
2.5s auto-dismiss with no manual-dismiss control. Pre-existing (Orders/Phase
A), not introduced by Phase B/C. **Not a blocker**, tracked below.

**Layering** — no pages importing other pages, no `components/` importing
from `pages/`, no `*-columns.tsx` file with an unusual import. Clean.

## Code review

**Duplication** — `DASH`/`formatMoney`/`formatDate` are centralized for
Finance's 8 tabs in `finance-shared.tsx`, but reimplemented verbatim in
`customers-columns.tsx`, `orders-columns.tsx` (pre-existing), and as a bare
`const DASH = "—"` in `products-columns.tsx`, `inventory-warehouse-columns.tsx`,
`master-data-columns.tsx`. A cross-module `lib/format.ts` was never carved
out despite the same three helpers existing in effectively five places.
**Real, worth fixing, not gate-blocking** — flagged as follow-up debt rather
than fixed under Phase C's "no refactors" constraint.

**Dead code** — none. No orphaned bespoke table markup left behind by any
migration; every `build*Columns` export has exactly one call site.

**Naming** — 11 of 12 columns files follow `build<Entity>Columns`; the one
outlier is `master-data-columns.tsx`'s `buildMdColumns` (abbreviation).
Minor, non-blocking.

**Comments** — spot-checked across Inventory, Customers, and Finance
Purchase Orders: consistently WHY-oriented, no restated-code comments found.

**Test quality** (the coverage-gate-closing commit, `d4a5067`) — spot-checked
3 of the 10 new `*-columns.test.tsx` files: real assertions against fixture
data, explicit null/undefined edge cases, and sort-comparator checks, not
coverage padding. Each does include one generic render-smoke-test alongside
the targeted ones, which is fine since it isn't the only assertion in the
file.

**TODOs/FIXMEs** — zero found across every file touched by the Phase A/B/C
commits.

## UI consistency review

**RTL** — exhaustive grep for hardcoded physical-direction Tailwind classes
(`ml-`/`mr-`/`pl-`/`pr-`/`text-left`/`text-right`/`left-`/`right-`/
`border-l-`/`border-r-`) across all 9 migrated module directories: **zero
hits**. The codebase uses logical properties (`ms-`/`me-`/`ps-`/`pe-`/
`text-start`/`text-end`) exclusively.

**Accessibility** — `Label htmlFor` + `aria-label` pairing is consistent
across Orders/Customers/Products/Inventory/Finance. One divergence:
`settings/notifications-page.tsx` uses a bare `<label><input></label>`
pattern instead of the `Field`/`htmlFor` convention — accessible, but
stylistically inconsistent. Minor, non-blocking.

**Empty/Loading/Error states** — every module that fetches and renders a
record collection uses the shared `LoadingState`/`EmptyState`/`ErrorState`
components. The two apparent gaps (Finance Reports, Onboarding) are
deliberate: Reports is a computed dashboard with an explicit in-code audit
note; Onboarding is a multi-step form with no list/detail view to
standardize.

**Design tokens** — no raw hex colors or arbitrary Tailwind values in place
of semantic tokens, except two isolated, defensible cases in Orders (the
reference module): a per-record user-defined label color with a sensible
gray fallback, and one `text-[10px]` micro-text utility. Minor,
non-blocking.

**Responsive layout & spacing** — `useIsDesktop()` is applied consistently
wherever a grid/card split is structurally relevant, and every module's root
container uses the same `gap-6 p-4 sm:p-6` shell spacing as the Orders
reference (only `max-w-*` varies, by legitimate content-width need).

## Open follow-up items (non-blocking)

None of these fail the EPIC-16 quality gate; documenting them here so they
aren't silently lost.

1. `FilterBar` (Inventory-only) and `SavedViews` (Orders-only) each still
   have a single production consumer — the next module needing real filters
   or saved views is the first real validation of these APIs at scale.
2. `orders-page.tsx:916-935`'s multi-line stock-shortage Toast message
   strains the fixed 2.5s auto-dismiss with no manual-dismiss control.
3. `DASH`/`formatMoney`/`formatDate` should be lifted out of
   `finance-shared.tsx` into a genuinely shared `lib/format.ts` and consumed
   by Customers/Orders/Products/Inventory/Master-Data instead of being
   reimplemented per module.
4. `master-data-columns.tsx`'s `buildMdColumns` should be renamed for
   naming consistency with the other 11 columns files.
5. `settings/notifications-page.tsx` should switch its checkbox labels to
   the `Field`/`htmlFor` convention used everywhere else.

## Verdict

**No gate-blocking findings.** EPIC-16's shared UI infrastructure is
generic, consistently consumed, RTL-correct, accessible, and free of dead
code or TODO markers across every migrated module. The five items above are
real but small, isolated, and safe to defer as follow-up work without
holding up the epic close.
