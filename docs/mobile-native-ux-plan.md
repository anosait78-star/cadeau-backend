# Mobile Native UX Plan

> Plan for raising the **Mobile shell** of `apps/web` from "responsive web" to the
> feel of a first-class iOS / Material application, without breaking **ADR-0002**
> (two independent shells, one visual identity) and without touching business
> logic, the API, or the database schema.
>
> Scope: `apps/web` mobile tree only. The Desktop shell is out of scope except
> where a shared primitive (tokens, `sheet.tsx`, `mobile-card-list.tsx`) is
> deliberately extended.

---

## Table of Contents

1. [Baseline](#1-baseline)
2. [Gap Analysis](#2-gap-analysis)
3. [Phase 0 — Physical Foundation](#phase-0--physical-foundation)
4. [Phase 1 — Navigation Hierarchy](#phase-1--navigation-hierarchy)
5. [Phase 2 — Motion and Gestures](#phase-2--motion-and-gestures)
6. [Phase 3 — Lists and Data](#phase-3--lists-and-data)
7. [Phase 4 — Forms and Input](#phase-4--forms-and-input)
8. [Phase 5 — Installed-App Feel (PWA)](#phase-5--installed-app-feel-pwa)
9. [Phase 6 — Gates and Measurement](#phase-6--gates-and-measurement)
10. [Sequencing](#10-sequencing)

---

## 1. Baseline

What already exists and is architecturally sound:

| Area            | File                                                | State                                                  |
| --------------- | --------------------------------------------------- | ------------------------------------------------------ |
| Shell selection | `components/shell/app-shell.tsx`                    | Viewport to Desktop or Mobile, separate trees          |
| Mobile shell    | `components/shell/mobile/mobile-shell.tsx`          | Sticky brand bar + `main` + FAB + bottom nav           |
| Bottom nav      | `components/shell/mobile/mobile-bottom-nav.tsx`     | 4 primary destinations + "More"                        |
| More sheet      | `components/shell/mobile/mobile-more-sheet.tsx`     | Overflow nav + theme/lang + sign out                   |
| Bottom sheet    | `components/ui/sheet.tsx`                           | Radix Dialog, grab handle, swipe-down (60px threshold) |
| Design tokens   | `styles/globals.css`                                | Colors, spacing, motion, typography; RTL-first         |
| Card lists      | `components/data-grid/mobile-card-list.tsx`         | Loading / empty / cards / load-more                    |
| PWA             | `public/manifest.webmanifest`, `lib/register-sw.ts` | Manifest, icons, install prompt, SW                    |

The structure is right. What is missing is the _physics_ — the details that make
a surface read as an application rather than a page.

## 2. Gap Analysis

| #   | Gap                                                 | Evidence                                                 | Impact                                                                                           |
| --- | --------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | No safe-area insets                                 | No `env(safe-area-inset-*)` anywhere in `apps/web/src`   | Bottom nav sits under the iOS home indicator; header under the notch                             |
| 2   | One static header for every route                   | `mobile-shell.tsx` renders the brand bar unconditionally | No navigation hierarchy, no back affordance — the largest single deviation from native           |
| 3   | No route transitions, no back gesture               | No transition wrapper in the mobile tree                 | Every navigation is a hard cut                                                                   |
| 4   | FAB is bound to search                              | `mobile-fab.tsx` calls `useCommandPalette().toggle()`    | Inverts both iOS and Material conventions: the FAB is for creation, search belongs in the header |
| 5   | Body type 14px, inputs below 16px                   | `--text-body: 0.875rem`                                  | iOS auto-zooms on focus; text reads as desktop-dense                                             |
| 6   | Load-more button, no pull-to-refresh                | `mobile-card-list.tsx`                                   | Pagination reads as a web page                                                                   |
| 7   | Generic spinner instead of shape-matched skeletons  | `states/loading-state`                                   | Flash and layout shift on every list                                                             |
| 8   | No haptics, no `:active` states                     | —                                                        | No immediate feedback under the finger                                                           |
| 9   | Single `theme-color`                                | `index.html`                                             | Status bar mismatches the dark theme                                                             |
| 10  | No `overscroll-behavior`, no background scroll lock | `globals.css`, `sheet.tsx`                               | The page scrolls behind an open sheet                                                            |

### 2.1 Confirmed by visual review

A pass over the running Mobile shell (iPhone-class viewport, Arabic/RTL, both
themes) turned up these concrete instances of the gaps above. They are recorded
here as the acceptance targets for the phases that own them.

| Screen     | What it looks like today                                                                                                                                                           | Owning phase                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Orders     | The desktop toolbar (New / Export / Print / overflow) reflows _above_ the page title as four buttons wrapping onto two rows — roughly 40% of the first viewport before any content | Phase 1 (header actions + FAB)             |
| All        | Every page renders its title plus a descriptive paragraph; on a phone that is a second screenful of chrome                                                                         | Phase 1 (large title, no subtitle)         |
| Orders     | The 12 status counts wrap as chips inside a tall card instead of a scrollable segmented strip                                                                                      | Phase 3                                    |
| Orders     | The filter panel is the desktop card verbatim, including two native date inputs rendering `mm/dd/yyyy` — US order, LTR, inside an RTL screen                                       | Phase 3 (filter sheet) + Phase 4 (pickers) |
| Orders     | Order cards are label/value grids: no leading element, no chevron, no swipe actions, nothing that reads as a tappable row                                                          | Phase 3                                    |
| All        | The FAB floats over card content and opens _search_, which the filter bar already offers one scroll above                                                                          | Phase 1 (FAB becomes create)               |
| Dashboard  | The KPI grid leaves a half-width card alone on its row with dead space beside it, and a lone action button right-aligned under it                                                  | Phase 3                                    |
| Dark theme | Card `#161618` on background `#0b0b0c` with a `#2a2a2e` border — surfaces barely separate from the page; native dark UI leans on elevation to keep cards readable                  | Phase 1 (chrome/elevation pass)            |
| Bottom nav | The active tab changes color only; the icon stays outlined                                                                                                                         | Phase 1                                    |

---

## Phase 0 — Physical Foundation

**Goal:** the app occupies the device correctly. Everything downstream depends on
this, so it lands first.

**Files:** `index.html`, `styles/globals.css`, `mobile-shell.tsx`,
`mobile-bottom-nav.tsx`, `mobile-fab.tsx`

1. **Viewport** — add `viewport-fit=cover` so `env(safe-area-inset-*)` resolves to
   real values instead of `0px`.
2. **Layout tokens** — introduce and use everywhere instead of hardcoded heights:
   ```css
   --safe-top: env(safe-area-inset-top, 0px);
   --safe-bottom: env(safe-area-inset-bottom, 0px);
   --safe-start: env(safe-area-inset-left, 0px);
   --safe-end: env(safe-area-inset-right, 0px);
   --mobile-header-height: 3.5rem;
   --mobile-nav-height: 3.25rem;
   ```
   The bottom nav becomes `height: calc(var(--mobile-nav-height) + var(--safe-bottom))`
   with matching `padding-bottom`; the header gets `padding-top: var(--safe-top)`;
   `main` gets a bottom padding derived from the same tokens rather than `pb-16`.
3. **Theme color per scheme** — a light and a dark `<meta name="theme-color">`
   with `media="(prefers-color-scheme: ...)"`, plus a runtime update from the
   `ThemeProvider` so the in-app toggle (which is authoritative over the OS) stays
   in sync with the status bar.
4. **Touch physics** — on `body`: `overscroll-behavior-y: none`,
   `-webkit-tap-highlight-color: transparent`, `touch-action: manipulation`
   (removes the 300ms tap delay).
5. **Mobile type scale** — body 17px / caption 13px on the mobile shell; a global
   rule forcing a 16px minimum font size on `input`, `select`, `textarea` below
   the desktop breakpoint (this alone removes iOS focus zoom); minimum touch
   target 44x44 for every interactive element in the mobile tree.
6. **Press feedback** — a shared `.pressable` utility: `scale(0.97)` on `:active`
   over `--motion-press`, disabled under `prefers-reduced-motion`.

**Acceptance:** on an iPhone-class emulated viewport, nothing renders beneath the
home indicator, no element is clipped by the notch, and focusing any field does
not zoom the page.

**Status: done.** Verified against the running shell with the insets forced to
iPhone values (59px top / 34px bottom): the header measures 115px with its
content below the status-bar band, the bottom nav 86px with its labels above the
home indicator, and content padding clears both. Fields resolve to 16px below the
desktop breakpoint and back to 14px above it, so iOS focus zoom is gone with no
change to the Desktop shell.

---

## Phase 1 — Navigation Hierarchy

**Goal:** the user always knows where they are and how to get back.

**New:** `components/shell/mobile/mobile-page-header.tsx`,
`components/shell/mobile/mobile-large-title.tsx`,
`hooks/use-scroll-collapse.ts`

1. **Contextual header.** Root destinations (Orders, Customers, Inventory, ...)
   render a _large title_ (28px, bold) that collapses into a centered 17px title
   on scroll. Detail routes render a compact header: back control, title, at most
   one trailing action.
2. **Collapse mechanism.** An `IntersectionObserver` sentinel at the top of the
   scroll container — not a `scroll` listener — so the collapse costs nothing on
   the main thread.
3. **Real back control.** `navigate(-1)` with a route-parent fallback when there
   is no history entry. The chevron is a logical-direction icon so it mirrors in
   RTL automatically.
4. **Translucent chrome.** Header and bottom nav get
   `backdrop-filter: blur(20px)` over `color-mix(in srgb, var(--card) 80%, transparent)`,
   with an opaque fallback where `backdrop-filter` is unsupported. Highest visual
   return per line of code in the whole plan.
5. **Bottom nav polish.** Filled icon on the active tab, 10px label, an active
   indicator, and tap-on-active-tab scrolls the list back to top (the iOS
   convention).
6. **FAB re-assignment.** The FAB becomes the primary _create_ action for the
   current section (new order, new customer, ...). Search moves into the header as
   a dedicated control that still opens the command palette.
7. **Dark elevation.** Raise the dark `--card` off the page background and make
   the border visible against it, so surfaces separate the way they do in native
   dark UI.

**Status: done.** The shell owns the title (`useMobileRouteTitle` reads it from
`navigation.ts`); `PageTitle` renders the heading on Desktop and nothing on
Mobile, which removed the duplicated `<h1>` every page had; the FAB carries the
screen's registered create action, with Orders as the first adopter; and the bars
are translucent with an opaque fallback. Remaining for a later pass: migrating
each screen's _secondary_ toolbar actions (export, print, tags) into a header
overflow menu — Orders still renders them as a row above its content.

---

## Phase 2 — Motion and Gestures

**Goal:** navigation and sheets respond to the finger, not to thresholds.

**New:** `components/shell/mobile/mobile-route-transition.tsx`,
`hooks/use-edge-swipe.ts`, `lib/haptics.ts`

1. **Route transitions.** Push slides in from the logical end edge, pop reverses,
   300ms on `cubic-bezier(0.32, 0.72, 0, 1)`. Uses the View Transitions API where
   available with a CSS fallback. Fully disabled under `prefers-reduced-motion`.
2. **Edge swipe back.** Built on the existing `use-swipe` hook but tracking the
   finger live (the screen follows the drag) instead of firing on a threshold. The
   active edge mirrors in RTL.
3. **Sheet detents.** `BottomSheet` gains `medium` (50%) and `large` (92%) stops,
   finger-following drag with rubber-band resistance past the top stop, and
   velocity-based dismissal. Adds `overscroll-behavior: contain` and a background
   scroll lock.
4. **Haptics.** A single `haptics` module wrapping `navigator.vibrate` with
   support detection: 10ms on tab change, 15ms on sheet open, an error pattern on
   failed validation. No-ops on unsupported platforms.

**Status: done, with one deliberate reduction.** Route transitions animate the
_entering_ screen only (`MobileRouteTransition`, keyed on pathname, suppressed on
the cold-open POP); the edge gesture and the sheet both follow the finger and
commit on distance _or_ velocity; `BottomSheet` gained `auto`/`medium`/`large`
detents. What is **not** built: dragging _between_ detents with snapping — a
sheet opens at the detent it was given and is either dragged away or springs
back. The View Transitions API was not used; the CSS keyframe covers the same
ground with no browser gate.

---

## Phase 3 — Lists and Data

**Files:** `mobile-card-list.tsx`, `components/states/*`, all mobile `*-page.tsx`

1. **Inset grouped list** as a second list idiom beside cards: leading element
   (thumb/avatar), title + secondary line, trailing value/badge, chevron.
   Separators start after the leading element.
2. **Shape-matched skeletons** per list type, replacing the generic spinner. Row
   height is fixed so nothing shifts when data arrives.
3. **Infinite scroll** via an `IntersectionObserver` sentinel, keeping the
   load-more button as the failure fallback and for reduced-motion/assistive use.
4. **Pull-to-refresh** as a shared wrapper around the mobile scroll container,
   with a drag-following indicator.
5. **Row swipe actions** (edit / delete) — the ADR-0002-sanctioned replacement for
   hover affordances, and more native than an overflow menu.
6. **Sticky search and filter bar** directly under the header; filters open in a
   bottom sheet and applied filters surface as removable chips.

**Status: 1–4 done, 5–6 not done.**

Landed: `MobileListRow` / `MobileListGroup` (inset separators drawn as a
pseudo-element so the row's own padding is untouched), `CardListSkeleton`
replacing the spinner, `useInfiniteScroll` (re-entrant-safe, with the explicit
control kept only where `IntersectionObserver` is missing), and
`usePullToRefresh` wired through the shell — screens register their reload with
`useRegisterMobileRefresh` the same way they register their create action.
Because all of this went into the shared `MobileCardList`, the skeleton and the
automatic paging reached all twelve of its consumers at once; the row idiom is
adopted on Orders, with Orders/Customers/Inventory registering refresh.

Not done, and why:

- **Row swipe actions** — the mobile lists as they stand have no unambiguous
  per-row edit/delete pair to reveal (orders move through status transitions,
  not deletion). Building the primitive with no honest place to use it would add
  dead code; the actions have to be decided per screen first.
- **Filter bar → sheet + chips** — Orders' filter bar is a 160-line desktop
  panel, including the two native date inputs that still render `mm/dd/yyyy` in
  an RTL screen. Converting it belongs with Phase 4's pickers rather than being
  half-done here.

---

## Phase 4 — Forms and Input

1. **Full-screen create/edit** on mobile (or a `large`-detent sheet), with a
   Cancel / Title / Save header. No cropped desktop modals.
2. **Sticky footer above the keyboard** using `100dvh` plus the `visualViewport`
   API to track keyboard height.
3. **Input semantics** on every field: `inputMode`, `autocomplete`,
   `enterKeyHint`. Small change, outsized effect on perceived nativeness.
4. **Native-feeling pickers** for date, quantity, and status — bottom sheets with
   large targets instead of the default `<select>`.
5. **Validation behavior** — scroll to the first invalid field, error haptic,
   message anchored under the field.

**Status: done, with two items resolved differently than planned.**

- **Full-screen forms** were already there: `Modal` drops to `h-[100dvh] w-screen`
  below `sm:`. What it lacked was the notch — it now pads by `--safe-top` on a
  phone and resets from `sm:` up.
- **Keyboard inset.** `useKeyboardInset` publishes the covered height as
  `--keyboard-inset` from the `visualViewport` API; `Modal` and `BottomSheet`
  consume it, so a form's footer ends above the keyboard instead of behind it.
  It is published globally because the surfaces that need it are portaled out of
  the tree that owns the form. **Not verifiable in an emulator** — no desktop
  browser raises a real keyboard — so this one needs a pass on a physical device.
- **Input semantics.** Phone fields became `type="tel"` with `inputMode`/
  `autoComplete`, email likewise, and the search fields `type="search"` with
  `enterKeyHint="search"`. The auth screens already carried theirs.
- **Pickers.** The eight remaining native `input[type=date]` controls (orders
  filter, analytics window, finance reports) now use the project's own
  `DatePicker` — which is what was rendering `mm/dd/yyyy`, US-ordered and LTR,
  inside an RTL screen. Status filters stay a native `<select>` **on purpose**: a
  phone already renders that as the OS picker, so replacing it with a custom
  sheet would trade a native control for an imitation of one.
- **Validation.** These forms disable submit while invalid, so there is no
  failed-submit moment to scroll to a field from — the planned behavior has
  nothing to attach to. The error haptic went where errors actually surface
  instead: any error toast now buzzes.

---

## Phase 5 — Installed-App Feel (PWA)

1. `display_override: ["standalone", "minimal-ui"]`, theme-matched
   `background_color`, and portrait orientation for handsets.
2. Real splash screens via `apple-touch-startup-image` for common device sizes,
   matching `background_color`.
3. App-shell precaching in `sw.js` for instant cold open, an offline banner, and a
   queue for actions taken while offline.
4. Toasts positioned above the bottom nav:
   `bottom: calc(var(--mobile-nav-height) + var(--safe-bottom) + 0.5rem)`.
5. Expanded `manifest.shortcuts` and order sharing through `navigator.share`.

**Status: 1, 3 (partly) and 4–5 done; 2 and the offline queue not done.**

- The manifest declares `display_override`, portrait orientation, and a splash
  background matching the app's light default — which is what `index.html` boots
  with, so a cold start no longer flashes the wrong color.
- `sw.js` precaches the shell **on install** (the previous version only cached
  after one successful online navigation, so the first offline launch failed)
  and now caches Vite's fingerprinted `/assets/` output. Without that second
  part the offline shell rendered an empty page: it referenced a bundle that was
  not in the cache. Hashed URLs are what make this safe to cache — a new build
  produces new URLs, so an entry can never go stale.
- `OfflineBanner` states the condition for as long as it lasts, in both shells.
  A toast would be wrong here: the condition outlives the message.
- The shortcut list gained "New order", and `?new=1` is now handled by the
  Orders screen (consumed on arrival so a reload does not reopen the form) —
  a shortcut that pointed at unimplemented behavior would just be a dead link.

Not done:

- **Splash screens** need generated PNGs per device size; that is a design-asset
  task, not a code one, and shipping `apple-touch-startup-image` tags pointing at
  files that do not exist would be worse than the default.
- **The offline action queue** is a feature, not a polish item: it means queuing
  mutations, replaying them on reconnect, and resolving conflicts against a
  server that stays authoritative (ADR-001). It needs its own design.
- **`navigator.share`** — deferred with the rest of the order-detail work.

---

## Phase 6 — Gates and Measurement

- Mobile Lighthouse budget in `lighthouserc.mobile.json`: Performance >= 90,
  CLS <= 0.05, INP <= 200ms.
- Playwright runs at real device sizes (iPhone SE, iPhone 15 Pro, Pixel 8) across
  the primary screens.
- Unit coverage for safe-area layout, the back gesture, sheet detents, and
  infinite scroll.
- Manual RTL review of every motion added — all horizontal movement must mirror.

**Status: done, with one metric substituted.**

- The mobile Lighthouse budget now asserts CLS ≤ 0.05, LCP ≤ 2500ms and
  **TBT ≤ 200ms**. INP was in the plan, but it is a _field_ metric — a Lighthouse
  lab run does not produce one, so asserting it would have meant asserting an
  audit that never appears. Total Blocking Time is the lab proxy for the same
  property (a main thread that stays free to answer the finger).
- Playwright runs the Mobile shell on three device profiles instead of one:
  Pixel 8, iPhone SE (the smallest screen everything must survive) and iPhone 15
  Pro (the only one where the safe-area insets are actually non-zero).
- Unit coverage landed for the back gesture, the sheet drag (distance, velocity,
  rubber-banding, and the scrolled-content case), the sheet's detents, infinite
  scroll (including re-entrancy and the no-`IntersectionObserver` fallback),
  pull-to-refresh, and the offline banner.
- **Safe-area layout is not unit-tested** and cannot usefully be: jsdom has no
  CSS engine, so a test there would assert class names rather than geometry. It
  is verified in a real browser instead — the insets forced to iPhone values and
  the resulting bar heights measured — and the `mobile-notched` Playwright
  project is what keeps it honest going forward.
- Every motion added is direction-driven by CSS custom properties that flip
  under `[dir="rtl"]`, and each was checked in the running RTL app rather than
  reasoned about: route transitions resolve `--route-offset: -100%` forward in
  RTL, and the back gesture starts at the right edge and translates negatively.

---

## 10. Sequencing

| Order | Phase             | Rationale                                                            |
| ----- | ----------------- | -------------------------------------------------------------------- |
| 1     | Phase 0           | Unblocks everything; nothing above it is correct without it          |
| 2     | Phase 1           | Largest perceived gain; together with Phase 0 covers most of the gap |
| 3     | Phase 2           | The multiplier on Phase 1                                            |
| 4     | Phase 3           | Highest surface area, safe to land incrementally per page            |
| 5     | Phase 4 / Phase 5 | Parallelizable                                                       |
| 6     | Phase 6           | Locks the result in against regression                               |

Phase 0 touches `globals.css`, which every surface depends on, so this work
belongs on its own branch (`feat/mobile-native-ux`) rather than sharing a branch
with in-flight backend changes.

---

## Appendix — Reviewing the shell without a database

The app is behind a real session, so a visual pass needs either a seeded database
or a stand-in for the BFF. For review work the cheap path is the second: run a
small stub that answers `/v1/me`, `/v1/access/capabilities` and the list
endpoints with plausible shapes, start the web dev server with
`VITE_API_BASE_URL` pointed at it, and seed `localStorage["cadeau.auth.tokens"]`
with a dummy pair before loading a route. No credentials are involved and no
database is required, and every component on screen is the real one.
