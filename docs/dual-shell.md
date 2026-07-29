# Dual Shell (EPIC-2)

Per **ADR-002**, Cadeau CRM ships **two independent experiences** that share only
the visual identity (the M1.6 design system) — not one responsive layout:

- **Desktop shell** — a power-user experience: sidebar + top bar + (later) command
  palette and multi-column detail panes.
- **Mobile shell** — a native-feeling experience: bottom nav, FAB, bottom sheets,
  and swipe.

[`AppShell`](../apps/web/src/components/shell/app-shell.tsx) selects the shell for
the current viewport (`useIsDesktop()` — `≥1024px`). The two are **separate
component trees**; neither is a reflow of the other.

```
apps/web/src/
  config/navigation.ts          primary nav as data (shared by both shells)
  hooks/use-media-query.ts      useMediaQuery / useIsDesktop
  components/shell/
    app-shell.tsx               viewport → Desktop | Mobile (+ command palette)
    app-actions.tsx             shared theme + language toggles
    desktop/                    desktop-shell · sidebar · topbar · user-menu · command-trigger
    mobile/                     mobile-shell · bottom-nav · more-sheet · fab
  components/command/           command-palette (cmdk)
  components/ui/sheet.tsx        bottom sheet (Radix Dialog + swipe-down dismiss)
  components/layout/            list-detail (multi-column, Desktop master/detail)
  hooks/use-swipe.ts            dependency-free touch swipe detection
  providers/command-palette-provider.tsx   ⌘K state + global shortcut
```

## Mobile shell

A native-feeling tree ([`MobileShell`](../apps/web/src/components/shell/mobile/mobile-shell.tsx)):
a top brand bar, scrollable content, a **fixed bottom nav** (four primary
destinations + **More**), a **FAB** that opens the command palette (the mobile ⌘K
equivalent), and a **More bottom sheet** (overflow nav + theme/language actions).
The sheet is a [`BottomSheet`](../apps/web/src/components/ui/sheet.tsx) — a Radix
dialog anchored to the bottom with a grab handle and **swipe-down to dismiss**
([`useSwipe`](../apps/web/src/hooks/use-swipe.ts), touch-based, dependency-free).

## Command palette (⌘K)

`⌘K` / `Ctrl+K` (or the topbar Search button) opens a cmdk palette that searches
**navigation** (from `navigation.ts`) and **quick actions** (toggle theme, switch
language) and runs the selection. State + the global shortcut live in
[`CommandPaletteProvider`](../apps/web/src/providers/command-palette-provider.tsx),
mounted inside the shell so it can navigate.

## Multi-column (master/detail)

[`ListDetailLayout`](../apps/web/src/components/layout/list-detail.tsx) is the
Desktop two-pane primitive: a list pane beside an optional detail pane (logical
`border-s`, RTL-correct), collapsing to list-only when nothing is selected. Domain
list/detail screens compose it rather than hand-rolling columns.

## Milestones

| #    | Scope                                                                          | Status |
| ---- | ------------------------------------------------------------------------------ | ------ |
| M2.1 | Shell switch + **Desktop shell** (sidebar · topbar · account menu) + nav model | ✅     |
| M2.2 | **Command Palette (⌘K)** (cmdk) + **multi-column** ListDetail layout           | ✅     |
| M2.3 | **Mobile shell** — Bottom Nav + FAB + Bottom Sheets + Swipe                    | ✅     |
| M2.4 | Independent UI testing (Desktop + Mobile) + a11y (axe) + perf budget           | ✅     |

## Conventions (ADR-002)

- **No hover/right-click for core functions** — every action has a click/tap path;
  every table gets a card alternative.
- Both shells render the **same routes** and the **same design-system components**;
  only the chrome differs.
- Navigation is **data-driven** ([`navigation.ts`](../apps/web/src/config/navigation.ts))
  so a nav item is defined once and both shells render it.
- Layout uses **logical** CSS (e.g. `border-e`), so the shells mirror correctly in
  RTL/LTR.

## Testing both shells (M2.4)

Each shell is tested independently (ADR-002):

- **Component (Vitest/jsdom):** shell switch, desktop sidebar/user-menu/command
  palette, mobile bottom-nav/more-sheet/FAB, and `useSwipe`.
- **E2E (Playwright):** two projects — `desktop` (≥1024px) and `mobile` (Pixel 5) —
  each exercising its shell (`e2e/desktop.spec.ts`, `e2e/mobile.spec.ts`; shared
  `e2e/smoke.spec.ts`), plus an **axe** accessibility check per shell.
- **Performance:** the bundle budget (≤200KB gzip) plus **Lighthouse** for both
  form factors (desktop + mobile) — see [performance-and-testing.md](performance-and-testing.md).
