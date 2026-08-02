# EPIC-16 Phase A — architecture review

Reviewed after the Products pilot migration, before continuing Phase B to
the remaining modules (Customers, Inventory, Warehouses, Shipments,
Finance, Analytics, Master Data, Notifications). See
[execution-plan.md](execution-plan.md) §EPIC-16 for the epic and the
Phase A/B/C plan agreed with the owner.

## What was built

All under `apps/web/src/components/`, generalized from Orders
(`apps/web/src/pages/orders/`), which remains the reference implementation:

| Component                    | Path                                | Purpose                                                                                                    |
| ---------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `Translate` type             | `i18n/translate-type.ts`            | Canonical shape of `useI18n().t`, replacing per-page redeclarations                                        |
| `StatusBadge`                | `status-badge/status-badge.tsx`     | Tone-based chip (`neutral/success/warning/destructive/info`); each module supplies its own status→tone map |
| `ToastProvider` / `useToast` | `toast/toast.tsx`                   | App-wide toast host (mounted once in `AppProviders`), replacing ad-hoc `notice` state + `setTimeout`       |
| `ConfirmDialog`              | `confirm-dialog/confirm-dialog.tsx` | Modal confirmation for destructive actions, built on Radix Dialog                                          |
| `FilterBar`                  | `filter-bar/filter-bar.tsx`         | Generic filter-row shell (active-count chip + clear-all), filter definitions stay page-specific            |
| `useSavedViews`              | `saved-views/use-saved-views.ts`    | Namespaced localStorage-backed custom views, built-in presets stay page-specific                           |
| `MobileCardList`             | `data-grid/mobile-card-list.tsx`    | Generic shape of the ADR-002 mobile card list (loading/empty/cards/load-more)                              |

`DataGrid`, `TableToolbar`, `BulkActionsBar`, `DetailPanel`,
`EmptyState`/`LoadingState`/`ErrorState` already existed from the Orders
build and needed no changes to be reused, except the one DetailPanel fix
below.

**Products** (`apps/web/src/pages/products/`) was migrated to this
infrastructure as the pilot: `products-columns.tsx` (new), desktop/mobile
split via `useIsDesktop()`, `TableToolbar` for search + create, row click
opens `DetailPanel`. No business logic changed — `products-api.ts` calls
are untouched.

## What was changed after the review

1. **`ConfirmDialog` — async-aware confirm, a11y warning fixed.**
   `onConfirm` originally had to be synchronous and the dialog closed
   immediately on click, before any API call it triggered could resolve —
   wrong for the exact use case this component exists for (delete/archive
   actions that call the backend). It now accepts `() => void | Promise<void>`,
   shows a disabled/pending state on both buttons while the promise is in
   flight, closes only on success, and stays open (for retry) if it
   rejects — the caller surfaces the error via `useToast`. Also fixed a
   real Radix a11y warning ("Missing Description or aria-describedby") that
   would have fired on every page that opens a confirm dialog without a
   `description`, which is expected to be the common case.

2. **`DetailPanel` — no more redundant single-tab UI.** It only ever
   rendered a `Tabs` strip, even for one section. That was fine for Orders
   (multiple sections) but produced an awkward "one tab that says the page
   name" UI the moment a page (like Products, and likely several more —
   Master Data, Notifications) only needs a single detail section. It now
   renders the section's content directly when `sections.length === 1` and
   only mounts the tab strip for 2+. Verified against the existing
   `detail-panel.test.tsx` (all cases use 2 sections) — no behavior change
   there.

3. **Products — removed duplicated JSX.** The card/edit-form branch was
   written out twice (once for the mobile list, once for the desktop
   detail panel) with only the closed-over variable name differing.
   Extracted into a single `renderProductDetail(product)` used by both.

All three fixes were re-verified: `tsc --noEmit` clean, full web suite
**282/282 tests pass** (unchanged count from before the fixes — nothing
regressed, no new business behavior).

## Genericity check

Went through each component's source specifically looking for Orders-only
assumptions (hardcoded order statuses, `OrderListItem` types, order routes,
etc.). None found — every component is typed generically (`<T>` where
relevant) or takes fully page-supplied data (labels, tones, filters,
sections). Orders' own `orders-columns.tsx` / `orders-saved-views.ts` were
refactored to _consume_ the shared versions rather than the shared versions
being copies of Orders' code, which is the direction that actually proves
genericity — Products (a second, independent consumer) reused every
component without modification, which is the strongest signal available
short of a third migration.

## API stability assessment

- `StatusBadge`, `Translate`, `MobileCardList`, `useSavedViews`: prop/type
  shapes are minimal and additive-only by construction (optional props,
  generic type params) — low risk of a breaking change during further
  rollout.
- `ConfirmDialog`, `useToast`: same, and now hardened by the async-confirm
  fix above before any other page depends on them.
- `FilterBar`: **not yet used by any page** (Products didn't need it — its
  only "filter" is the search box, already covered by `TableToolbar`). Its
  API is a reasonable guess based on Orders' hand-rolled filter dropdowns
  and Inventory's warehouse/`lowOnly` selects, but it is unvalidated
  against a real integration. This is the one component where a shape
  change is plausible once the first real consumer (likely Inventory or
  Customers) is migrated.

## Remaining risks

- **`FilterBar` unvalidated** (above) — expect to adjust its API on first
  real use, not a blocker but flagged so it isn't mistaken for
  battle-tested.
- **Toast has no manual dismiss control** — messages auto-dismiss after a
  fixed duration (2.5s default, override via `durationMs`) with no close
  button. Fine for the current short confirmation-style messages; would
  need a dismiss affordance if a future page wants to show a longer or
  more important message (e.g. the multi-line stock-shortage message from
  EPIC-15 already pushes on this — it's currently still readable but on
  the edge of what a 2.5s auto-dismiss comfortably allows).
- **No desktop-DataGrid test coverage** — this predates Phase A: neither
  `orders-page.test.tsx` nor `products-page.test.tsx` exercises the
  `isDesktop === true` branch (the test harness defaults to mobile, and
  no test calls `setViewport(true)`). Both pages' desktop paths are only
  verified by `tsc --noEmit` + the shared `DataGrid`/`DetailPanel`
  component-level tests, not an end-to-end render of the real page in
  desktop mode. Not introduced by this work, but worth fixing before
  Phase C (or as part of the next module's migration) rather than letting
  it compound across 7 more pages.
- **No live browser verification performed** for the Products migration
  (no dev server / seeded backend was run in this session) — verification
  was `tsc --noEmit` + the full Vitest suite (282/282 passing) only.

## Verdict

**Approved to continue Phase B** to the remaining modules using this
infrastructure as-is. The three fixes above are landed and verified;
nothing else in the shared components carries Orders-specific logic or an
API shape likely to break under the planned rollout. The one open item
(`FilterBar`) is not a reason to hold — it will get its first real
validation naturally on whichever module needs actual filters first
(Inventory or Customers), and its shape is additive enough that adjusting
it then is expected to be non-breaking for Products (which doesn't use it).
