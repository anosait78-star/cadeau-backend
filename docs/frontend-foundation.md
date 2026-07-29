# Frontend Foundation (M1.6)

`@cadeau/web` is the Cadeau CRM web app. M1.6 establishes the **shared frontend
foundation**: design tokens, theme (light/dark), text direction (RTL/LTR), i18n
scaffolding, a single base layout, and the standard Empty/Loading/Error states.

> **Scope boundary (ADR-002):** this is the _shared_ foundation only. The two
> independent shells — Desktop (Sidebar + Topbar + ⌘K) and Mobile (Bottom Nav +
> FAB + Bottom Sheets) — are built on top of this in **EPIC-2**, not here.

## Stack

| Concern    | Choice                                                             |
| ---------- | ------------------------------------------------------------------ |
| Framework  | React 19 + Vite 8, TypeScript `strict` (+ `verbatimModuleSyntax`)  |
| Styling    | Tailwind CSS v4 (CSS-first) with design tokens as CSS variables    |
| Components | shadcn/Radix-style primitives (`cn` + `cva`), hand-rolled here     |
| Routing    | `react-router` 8 (`createBrowserRouter`)                           |
| i18n       | Minimal, dependency-free provider (ar/en), locale drives direction |
| Test       | Vitest + Testing Library (jsdom)                                   |

`react-router` (not `react-router-dom`) is used directly — in React Router v7+
`react-router` is the primary package; `react-router-dom` is a re-export shim
still pinned to the vulnerable 7.x line (we require the patched 8.3.0).

## Design tokens & theming

Tokens live in [`src/styles/globals.css`](../apps/web/src/styles/globals.css) as
CSS variables and are exposed to Tailwind via `@theme inline`, so utilities like
`bg-primary` / `text-foreground` resolve to the variables and react to the active
theme. The brand identity is **monochrome red `#E11931` + white + neutral grays**
(no gold, no foreign accent).

- **Theme** is controlled by `data-theme` on `<html>` (`light` / `dark`), not the
  OS, so the in-app toggle is authoritative. Initial value = a stored choice, else
  the OS `prefers-color-scheme`. Persisted to `localStorage`.
- Dark utilities apply under `[data-theme="dark"]` via a Tailwind `@custom-variant`.

## Direction (RTL/LTR) & i18n

- The **locale is the single source of truth** for language _and_ direction:
  Arabic → `lang="ar"` + `dir="rtl"`, English → `lang="en"` + `dir="ltr"`. Arabic
  is the default (the product is Arabic-first). Persisted to `localStorage`.
- Layouts use **logical** Tailwind utilities (flex rows reverse under `dir`), so
  no component hard-codes left/right.
- i18n is a small, dependency-free provider ([`src/i18n/`](../apps/web/src/i18n/))
  with `ar`/`en` dictionaries type-checked against a shared `TranslationKey`, a
  `t(key, vars?)` with `{{var}}` interpolation, and a `useI18n()` hook. Swapping in
  a heavier library later (if needed) only touches this module.

## Standard states

Reusable, theme- and locale-aware components in
[`src/components/states/`](../apps/web/src/components/states/):

- **`LoadingState`** — centered spinner + localized label (`role="status"`).
- **`EmptyState`** — title, description, optional action/icon.
- **`ErrorState`** — title, message, optional retry (`role="alert"`).

Every screen uses these rather than ad-hoc markup, so empty/loading/error looks
consistent everywhere.

## Structure

```
apps/web/src/
  main.tsx                 entry (mounts <App/>)
  app.tsx                  providers + RouterProvider
  router.tsx               routes (all under AppLayout)
  providers/               theme-provider, app-providers
  i18n/                    dictionaries, i18n-provider (locale + direction)
  components/
    ui/                    button, card, spinner (design system)
    states/                loading / empty / error
    layout/                app-layout (single base), app-header (toggles)
  pages/                   home-page (showcase), not-found-page
  styles/globals.css       Tailwind v4 + design tokens
```

## Commands

```bash
pnpm --filter @cadeau/web dev          # Vite dev server (http://localhost:5173)
pnpm --filter @cadeau/web build        # production build → dist/
pnpm --filter @cadeau/web preview      # serve the production build
pnpm --filter @cadeau/web type-check   # tsc --noEmit
pnpm --filter @cadeau/web test         # Vitest + Testing Library (coverage)
```

## Testing & acceptance

Vitest + Testing Library cover the theme provider, i18n/direction provider, the
design-system components, and the standard states. An **integration test**
([`src/app.test.tsx`](../apps/web/src/app.test.tsx)) boots the full `<App/>` and
asserts the M1.6 acceptance criteria: the SPA renders (Arabic/RTL by default), the
**language toggle flips direction** (RTL↔LTR), the **theme toggle flips**
(light↔dark), and the standard states render. Verified additionally in a real
browser (boot + both toggles + `localStorage` persistence).

The production bundle is ~**102 KB gzip** (JS) + ~3 KB gzip (CSS) — comfortably
under the 200 KB gzip budget that M1.7 will enforce in CI.
