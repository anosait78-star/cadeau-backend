# Cadeau CRM — UI/UX Roadmap

> Official design roadmap for the Cadeau CRM web app (`apps/web`). This document merges the original Design Audit with a set of prioritized product-design recommendations and re-sequences the execution order around **Forms** as the top priority.
>
> **Scope constraint (non-negotiable):** everything in this document is UI/UX only. No business logic changes, no API changes, no database schema changes, no feature removal, no new framework. This is documentation and planning — no code was modified to produce it.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Page-by-Page Scoring](#2-page-by-page-scoring)
3. [Findings by Priority](#3-findings-by-priority)
4. [New Recommendation Areas](#4-new-recommendation-areas)
   - 4.1 [Forms (Top Priority)](#41-forms-top-priority)
   - 4.2 [Unified Dialog System](#42-unified-dialog-system)
   - 4.3 [Wizard / Step Forms](#43-wizard--step-forms)
   - 4.4 [KPI Cards](#44-kpi-cards)
   - 4.5 [Semantic Icon Coloring](#45-semantic-icon-coloring)
   - 4.6 [Professional Tables (DataGrid)](#46-professional-tables-datagrid)
   - 4.7 [Order Details Page](#47-order-details-page)
   - 4.8 [Customer Profile](#48-customer-profile)
5. [Design System Specification](#5-design-system-specification)
6. [Execution Roadmap (Reordered)](#6-execution-roadmap-reordered)
7. [Competitive Benchmark](#7-competitive-benchmark)
8. [What's Already Working](#8-whats-already-working)
9. [Effort-Based Summary](#9-effort-based-summary)

---

## 1. Executive Summary

Cadeau CRM's frontend (`apps/web`) sits on a genuinely strong engineering foundation: a consistent `loading / error / empty / ready` state machine reused across nearly every page, first-class RTL/Arabic support (logical CSS properties, forced `dir="ltr"` for numerals, `Noto Sans Arabic` in the font stack, Arabic as the default locale), a shared component layer (`DataGrid`, `EmptyState`/`ErrorState`/`LoadingState`, `StatusBadge`), and a deliberate, disciplined brand color decision (monochrome red `#E11931`, explicitly documented in code as "no gold, no foreign accent color").

What's missing is the **polish layer**: no centralized typography scale, no shadow/elevation tokens, hand-rolled charts with no gridlines/tooltips, zero breadcrumbs anywhere in the app, incomplete focus states, and several forms/panels with no responsive classes at all.

This revision adds a second, equally important gap on top of the original audit: **the system's forms — the actual data-entry surfaces where staff spend most of their day (Create Order, Create Customer, Create Payment, etc.) — are still built as flat, single-column admin forms.** They work, but they read as internal tooling, not as a product. Because forms are where operational cost is paid every single day (order creation in particular), **Forms now rank above Charts and even above Dashboard polish** in the execution order below.

**Overall system score (unchanged from the original audit, carried forward):**

| Dimension       | Score    |
| --------------- | -------- |
| UI              | 5.7 / 10 |
| UX              | 6.6 / 10 |
| Professionalism | 5.2 / 10 |

The recurring pattern across every page: **UX outscores UI.** The architectural and interaction decisions (state machine, permissions, RTL) are correct; the visual execution (type/shadow/spacing/forms) was never built as a system — each page improvised its own details.

---

## 2. Page-by-Page Scoring

Scores are based on direct review of the actual page components (not assumptions). **Professionalism** measures how close a page feels to a paid, polished SaaS product, independent of whether the feature itself works correctly.

### Dashboard — 6.0 / 10

| UI   | UX   | Professionalism |
| ---- | ---- | --------------- |
| 6/10 | 7/10 | 5/10            |

Good structure (KPI grid → charts → activity), but charts are hand-rolled SVG/CSS with no gridlines or tooltips, and every card carries the same visual weight regardless of the importance of the data it shows.

### Orders — 6.7 / 10

| UI     | UX     | Professionalism |
| ------ | ------ | --------------- |
| 6.5/10 | 7.5/10 | 6/10            |

The strongest page in the system: saved views, live-count status tabs, a capable DataGrid with bulk actions. Missing breadcrumbs; table row height/density is not governed by a defined scale. The **create-order form itself is the weakest part of this otherwise-strong page** — see [§4.1](#41-forms-top-priority) and [§4.3](#43-wizard--step-forms).

### Customers — 5.8 / 10

| UI     | UX   | Professionalism |
| ------ | ---- | --------------- |
| 5.5/10 | 7/10 | 5/10            |

A smart privacy touch (phone numbers masked until explicitly requested), but the create/edit form is a plain card with native fields and no visual grouping, and the governorate `<select>` breaks consistency with the rest of the Radix-based component set.

### Products / Inventory — 6.0 / 10

| UI     | UX     | Professionalism |
| ------ | ------ | --------------- |
| 5.8/10 | 6.5/10 | 5.5/10          |

Inherits the strong shared DataGrid, but critical inventory states (near-stockout) carry no visual distinction — they read with the same weight as any other number in the table.

### Finance / Analytics — 5.3 / 10

| UI   | UX   | Professionalism |
| ---- | ---- | --------------- |
| 5/10 | 6/10 | 5/10            |

The highest tab count in the system (8 tabs under Finance alone) with no visual hierarchy between them; hand-rolled sparklines fall well short of the polish a finance stakeholder expects from a Stripe-level dashboard.

### Settings — 5.3 / 10

| UI   | UX   | Professionalism |
| ---- | ---- | --------------- |
| 5/10 | 6/10 | 5/10            |

5 of 7 settings panels ship with **zero responsive classes** — a real risk of content overflow on narrower screens. Tab navigation is simple with weak active-state distinction.

### Auth / Onboarding — 6.2 / 10

| UI   | UX     | Professionalism |
| ---- | ------ | --------------- |
| 6/10 | 6.5/10 | 6/10            |

The first impression of the product, and it also ships with zero responsive classes. Layout is clean but carries no brand personality beyond a plain white card.

### Master Data / Admin — 4.8 / 10

| UI     | UX     | Professionalism |
| ------ | ------ | --------------- |
| 4.5/10 | 5.5/10 | 4.5/10          |

The least visually invested area of the system — understandable given low usage frequency, but it still reads as an internal admin screen rather than part of the product.

---

## 3. Findings by Priority

### Critical

- [ ] **No centralized typography scale.** Font sizes are chosen ad hoc per component (`text-2xl`, `text-sm`, `text-xs` scattered throughout). This is the root cause of the "inconsistent" feeling across nearly every page.
- [ ] **No shadow / elevation token system.** No shadow tokens are defined at all. Modals, dropdowns, and cards all sit at the same visual "height" — there's no felt sense of layering.
- [ ] **Charts are visually primitive.** `SalesChart`, `StatusChart`, and `Sparkline` are hand-drawn SVG/CSS: single color, no gridlines, no hover tooltip, no legend, no load-in animation.
- [ ] **No breadcrumbs anywhere in the system.** Users inside `Settings → Shipping`, `Finance → Reconciliations`, or an order's detail panel have no visual indicator of where they are in the hierarchy.
- [ ] **Incomplete focus states.** `focus-visible` is only defined inside `button.tsx`. Custom-built Orders status tabs, nav links, and native `<select>` fields have no dedicated visible focus ring.
- [ ] **Whole panels/pages ship with zero responsive classes.** 5 of 7 Settings panels, Login/Register, all of Onboarding, and the Orders create form contain no `sm:`/`lg:` classes at all.
- [ ] **Forms are flat, single-column admin forms** (see [§4.1](#41-forms-top-priority)) — now elevated to Critical given how much daily operational time is spent inside them.

### High

- [ ] No unified spacing scale — padding/gap choices vary between pages without a stated rule.
- [ ] No date-picker component — native `input[type=date]` breaks consistency with the rest of the Radix-based library.
- [ ] Empty states are text-based with no confirmed action-oriented CTA pattern.
- [ ] No micro-interactions anywhere — no hover/press transitions on cards, buttons (beyond base CVA), or table rows.
- [ ] No unified Dialog specification — modal sizing/padding/footer layout is inconsistent across the app (see [§4.2](#42-unified-dialog-system)).
- [ ] Order Create is a long flat form rather than a guided flow (see [§4.3](#43-wizard--step-forms)).
- [ ] KPI cards show a bare number with no trend/comparison context (see [§4.4](#44-kpi-cards)).

### Medium

- [ ] Sidebar's active nav item relies only on a faint background tint — no accent bar or icon-weight change.
- [ ] No visual distinction for critical inventory states (low stock reads like any other number).
- [ ] Native `<select>` used for governorate in the customer form.
- [ ] Command palette (⌘K) exists in code but has no visual affordance to help users discover it.
- [ ] Icons carry no semantic color coding — success/warning/danger/info/primary states all render the same (see [§4.5](#45-semantic-icon-coloring)).
- [ ] DataGrid lacks column resize, column density control, and a refined hover/selected-row treatment (see [§4.6](#46-professional-tables-datagrid)).
- [ ] Order Details is organized as flat tabs rather than a scannable, sectioned layout (see [§4.7](#47-order-details-page)).
- [ ] Customer profile shows raw fields instead of a summarized, activity-centric profile (see [§4.8](#48-customer-profile)).

### Low

- [ ] No illustrative/decorative imagery anywhere in the system (zero `<img>` usage) — acceptable for a CRM, but a missed opportunity in empty/onboarding states.
- [ ] The border-radius scale is limited to 3 steps (sm/md/lg) and needs an audit to confirm consistent application.

---

## 4. New Recommendation Areas

These sections are new additions to the audit, merged in and cross-referenced against the findings above. They do not duplicate existing recommendations — they extend them into concrete, page-specific specs.

### 4.1 Forms (Top Priority)

**Why this now outranks Charts:** dashboards are viewed; forms are _operated_, repeatedly, by staff, every single day. A slow or unpleasant Create Order form has a direct, compounding operational cost that a slightly plain chart does not. Forms move to the top of the execution order for this reason.

The following forms require a **complete redesign**, not incremental cleanup, targeting the quality bar of **Shopify / Stripe / Linear** — not typical admin-panel forms:

- [ ] Create Order
- [ ] Create Customer
- [ ] Edit Customer
- [ ] Create Product
- [ ] Edit Product
- [ ] Create Shipment
- [ ] Create Payment
- [ ] Create Purchase Order
- [ ] Create Expense
- [ ] Create Supplier

**Redesign principles for all ten forms:**

| Principle                   | Current state                                     | Target                                                                                                         |
| --------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Layout                      | Single flat column, native-feeling fields         | Grouped sections with clear labels (e.g. "Customer", "Shipping", "Items"), responsive 2-column grid on desktop |
| Field height                | Inconsistent across input/select/button           | Unified 40px                                                                                                   |
| Validation                  | Inline, but not confirmed to reserve layout space | Helper/error text reserves a fixed row height to prevent layout shift                                          |
| Required vs optional        | Not visually distinguished                        | Clear required-marker convention, optional fields labeled "optional"                                           |
| Long forms                  | One continuous scroll (Create Order)              | Split into a wizard — see [§4.3](#43-wizard--step-forms)                                                       |
| Save affordance             | Standard submit button                            | Sticky footer action bar for long forms, so Save/Cancel stay reachable without scrolling                       |
| Governorate / region fields | Native `<select>`                                 | Searchable Combobox (Radix Popover + list), consistent with the rest of the component library                  |
| Date fields                 | Native `input[type=date]`                         | Custom Date Picker component (Radix Popover + calendar grid)                                                   |

**Impact:** Very High · **Complexity:** High (10 forms × redesign + 2 new shared components: Combobox, Date Picker)

---

### 4.2 Unified Dialog System

Every modal in the system currently sizes and structures itself independently. Define **one** dialog specification and retrofit all existing modals/sheets onto it.

**Standard sizes:**

| Size        | Max width     | Typical use                                                                 |
| ----------- | ------------- | --------------------------------------------------------------------------- |
| Small       | 420px         | Confirm dialogs, single-field prompts                                       |
| Medium      | 560px         | Standard create/edit forms (Create Customer, Create Supplier)               |
| Large       | 760px         | Multi-section forms (Create Product, Create Purchase Order)                 |
| Extra Large | 960px         | Dense forms, embedded tables (Create Order fallback, Reconciliation review) |
| Fullscreen  | 100vw / 100vh | Wizards on mobile, complex multi-step flows                                 |

**Shared structure for every size:**

- Fixed header: title (H3, 16/24·600) + optional subtitle + close button, `padding: 20px 24px`, `border-bottom: 1px solid var(--border)`
- Body: `padding: 24px`, scrollable independently of header/footer
- Fixed footer: right-aligned button group (in RTL: start-aligned per logical properties), secondary action first, primary action last, `padding: 16px 24px`, `border-top: 1px solid var(--border)`
- Overlay: `rgba(0,0,0,.4)` + subtle blur
- Entrance: fade + scale (0.96 → 1), 180ms
- No modal in the system should declare an ad hoc width — every dialog invocation must select one of the five sizes above.

**Impact:** High · **Complexity:** Medium (one shared component update, then a pass over every `Modal`/`Sheet` call site to assign a size)

---

### 4.3 Wizard / Step Forms

Large, multi-domain forms should become guided multi-step wizards instead of one long scroll. **Create Order** is the primary candidate, given it's the single highest-frequency creation flow in the system.

**Proposed Create Order flow:**

1. **Customer** — search existing customer or create inline
2. **Shipping Address** — select saved address or add new
3. **Products** — add line items, quantities, pricing
4. **Shipping Information** — carrier, method, COD/prepaid
5. **Summary** — full review + confirm

**Wizard UX requirements:**

- Persistent step indicator (numbered, with completed/current/upcoming states)
- Back/Next navigation with state preserved across steps (no data loss going back)
- Validation scoped per step — a user cannot advance with an invalid step, but earlier steps stay editable from the summary
- Summary step shows an editable recap of every previous step (click any section to jump back)
- Uses the **Extra Large** or **Fullscreen** dialog size from [§4.2](#42-unified-dialog-system)

Other candidates for the same wizard treatment once the pattern is built: Create Purchase Order (supplier → items → terms → review), Create Shipment (order → carrier → package details → review).

**Impact:** High · **Complexity:** High (new shared `Wizard` component + Create Order rebuild)

---

### 4.4 KPI Cards

Upgrade dashboard/analytics KPI cards from a bare number to a decision-ready tile, following the pattern set by **Stripe Dashboard** and **Vercel Analytics**.

Every KPI card should support:

- [ ] Trend indicator (up/down arrow)
- [ ] Percentage change vs. previous period
- [ ] Previous-period comparison value shown alongside the current one
- [ ] Icon representing the metric
- [ ] Color coding tied to trend direction (positive/negative/neutral — using the existing semantic tokens, not the brand accent)
- [ ] Optional inline sparkline for metrics with a meaningful trend line

This directly extends the original audit's "shadow tokens" and "chart polish" recommendations — KPI cards should use the same gridline/tooltip conventions defined for `SalesChart` in [§5](#5-design-system-specification).

**Impact:** High · **Complexity:** Medium

---

### 4.5 Semantic Icon Coloring

Icons across the system (lucide-react, used consistently — this stays unchanged) currently render in a single neutral color regardless of what they represent. Introduce semantic coloring so an icon communicates state at a glance, without reading the adjacent label:

| State   | Token        | Example use                                  |
| ------- | ------------ | -------------------------------------------- |
| Success | `--success`  | Delivered, Paid, Completed                   |
| Warning | `--warning`  | Pending, Low stock, Awaiting review          |
| Danger  | `--critical` | Cancelled, Failed payment, Overdue           |
| Info    | `--info`     | Informational tooltips, system notices       |
| Primary | `--accent`   | Primary actions only — never used for status |

Rule: semantic color is reserved for _state_ icons only (status badges, alerts, notification bell counts). Structural/navigation icons (sidebar, toolbar) stay neutral so the semantic palette keeps its signal value.

**Impact:** Medium · **Complexity:** Low (token mapping + a pass over `StatusBadge` and notification components)

---

### 4.6 Professional Tables (DataGrid)

The shared `DataGrid` is architecturally solid (sort, multi-select, keyset infinite scroll, roving keyboard focus) and should **not** be rebuilt — it should be extended:

- [ ] Sticky header with a defined background/border (extends the original audit's table-row-height recommendation)
- [ ] Column resize (drag handle on column border)
- [ ] Column visibility control (the `column-visibility-menu.tsx` component already exists — confirm it's exposed consistently across all DataGrid instances, not just some)
- [ ] Density control (Comfortable / Compact toggle — 44px vs 36px row height)
- [ ] Refined hover state (`bg-muted` at ~40% opacity, per the original design-system spec)
- [ ] Refined selected-row state (tinted background + persistent checkbox, not just a border)
- [ ] Standardized row height (44px desktop / 56px mobile card list — carried over from the original audit)
- [ ] More internal whitespace in cell padding (12px → 16px horizontal)

**Impact:** High (touches every list page in the system) · **Complexity:** Medium (single shared component, wide blast radius of testing)

---

### 4.7 Order Details Page

Order Details is the single most important screen in the system — it's where support, operations, and fulfillment all converge. Redesign it from flat tabs into a **sectioned, scannable layout**, in the style of modern CRMs (Linear issue view, HubSpot deal view):

**Proposed structure:**

1. **Header** — order number, status badge, primary actions (sticky on scroll)
2. **Timeline** — status history as a vertical timeline, not a flat log
3. **Customer Card** — compact summary with link to full profile ([§4.8](#48-customer-profile))
4. **Products** — line items table
5. **Payments** — payment records, method, status
6. **Shipments** — carrier, tracking, current status
7. **Notes** — internal notes/comments
8. **Activity** — full audit trail

Sections render as stacked cards on a single scrollable page (or a two-column layout on desktop: primary content left, Customer/Payments/Shipments as a right rail), replacing the current flat-tab structure. This reuses the `DetailPanel` component that already exists — the change is informational architecture, not a new component.

**Impact:** Very High · **Complexity:** High

---

### 4.8 Customer Profile

Upgrade the customer profile from raw field display to a relationship-centric profile, inspired by **HubSpot**:

- [ ] Avatar (initials-based, no image upload required — consistent with the system's current icon-only visual language)
- [ ] Customer summary card (name, contact, tags, lifetime value)
- [ ] Recent Orders (last 5, linked)
- [ ] Shipments (recent, status-tagged)
- [ ] Payments (recent, status-tagged)
- [ ] Timeline (unified activity feed — orders, notes, status changes)
- [ ] Notes
- [ ] Quick Actions (Create Order for this customer, Call, Add Note) — a persistent action bar rather than a buried menu

**Impact:** High · **Complexity:** Medium-High

---

## 5. Design System Specification

Built on top of the tokens that already exist in `globals.css` (brand primary `#E11931` — a deliberate, already-enforced brand decision, preserved here) plus every gap identified above.

### Color

| Token            | Light     | Dark      | Usage                                                                                      |
| ---------------- | --------- | --------- | ------------------------------------------------------------------------------------------ |
| `--primary`      | `#E11931` | `#E11931` | Brand accent — primary actions only                                                        |
| `--foreground`   | `#18181B` | `#F4F4F5` | Base text                                                                                  |
| `--muted`        | `#F4F4F5` | `#1F1F23` | Backgrounds, subtle fills                                                                  |
| `--success`      | `#16A34A` | `#22C55E` | Positive state                                                                             |
| `--warning`      | `#D97706` | `#F59E0B` | Caution state                                                                              |
| `--destructive`  | `#DC2626` | `#EF4444` | Negative/error state                                                                       |
| `--info` _(new)_ | `#2563EB` | `#60A5FA` | Informational state — not currently defined, needed for [§4.5](#45-semantic-icon-coloring) |

### Typography

| Role     | Size / Line-height        | Weight |
| -------- | ------------------------- | ------ |
| Display  | 28 / 36                   | 800    |
| H1       | 24 / 32                   | 700    |
| H2       | 20 / 28                   | 700    |
| H3       | 16 / 24                   | 600    |
| Body     | 14 / 22                   | 400    |
| Caption  | 12 / 16                   | 500    |
| Numerals | tabular-nums, `dir="ltr"` | —      |

### Spacing

| Token                 | Value   |
| --------------------- | ------- |
| Page gutter (mobile)  | 16px    |
| Page gutter (desktop) | 24–32px |
| Section gap           | 32px    |
| Card padding          | 24px    |
| Form field gap        | 16px    |

### Radius

| Token | Value  | Usage           |
| ----- | ------ | --------------- |
| xs    | 4px    | Badges          |
| sm    | 6px    | Buttons, inputs |
| md    | 8px    | Cards           |
| lg    | 14px   | Modals, sheets  |
| full  | 9999px | Avatars, pills  |

### Shadows

| Token | Value                         | Usage               |
| ----- | ----------------------------- | ------------------- |
| xs    | `0 1px 2px rgba(0,0,0,.06)`   | Cards               |
| md    | `0 6px 20px rgba(0,0,0,.12)`  | Dropdowns, popovers |
| lg    | `0 20px 50px rgba(0,0,0,.20)` | Modals              |

### Components

| Component            | Spec                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Buttons              | 40px (md) / 34px (sm) height, 16px horizontal padding, hover `opacity .92` 150ms, active `scale .98` 100ms                                                   |
| Inputs               | 40px height, 1px border, focus ring 2px `--ring` + 2px offset, error state = border `--destructive` + reserved helper-text row                               |
| Dialogs              | See [§4.2](#42-unified-dialog-system)                                                                                                                        |
| Tables               | See [§4.6](#46-professional-tables-datagrid)                                                                                                                 |
| Badges               | 22px height, soft background + dot/icon + label, tones: success/warning/destructive/info/neutral                                                             |
| Icons                | lucide-react (unchanged), 16/18/20px, 1.75px stroke, semantic coloring per [§4.5](#45-semantic-icon-coloring)                                                |
| Loading              | Shimmer skeleton, 1.4s ease-in-out infinite loop (replaces flat gray placeholder)                                                                            |
| Toast                | Max 3 stacked, 4s display (pauses on hover), slide+fade 200ms                                                                                                |
| Empty States         | Icon + one-line heading + one-line description + CTA, 320px max width, centered                                                                              |
| Pagination / Filters | Keyset infinite scroll retained; add a "showing X of Y" counter above the table                                                                              |
| Sidebar / Navbar     | 240px sidebar width retained; active item gets a 3px accent bar + background tint + bolder icon                                                              |
| Charts / KPI cards   | 1px gridlines at 20% opacity, cursor-following tooltip (`bg-surface` + `shadow-md`), warning-state cards get a 4px accent border — see [§4.4](#44-kpi-cards) |
| Wizard               | New component — step indicator, per-step validation, editable summary — see [§4.3](#43-wizard--step-forms)                                                   |
| Combobox             | New component — searchable list on Radix Popover, replaces native `<select>` where options exceed ~8 items                                                   |
| Date Picker          | New component — Radix Popover + calendar grid, replaces native `input[type=date]`                                                                            |

---

## 6. Execution Roadmap (Reordered)

The original audit's 9-phase roadmap is superseded by the sequence below, which promotes **Forms** ahead of Dashboard/Charts. Rationale: Phase 1 tokens are reused by everything downstream, and Forms are the highest-frequency, highest-operational-cost surface in the product — they should be fixed before further investment goes into surfaces users only view.

### Phase 1 — Design System Foundation

**Goal:** Typography scale, spacing scale, radius scale, shadow tokens, motion tokens (durations/easings), global focus-visible ring.
**Benefit:** Every later phase consumes these tokens directly instead of improvising — highest return on investment in the whole roadmap.
**Estimated time:** 1–1.5 weeks
**Impact:** Very High · **Complexity:** Low-Medium

### Phase 2 — Forms

**Goal:** Redesign the ten priority forms ([§4.1](#41-forms-top-priority)); ship the shared Dialog system ([§4.2](#42-unified-dialog-system)); ship Combobox and Date Picker components; ship the Wizard component and rebuild Create Order as a 5-step flow ([§4.3](#43-wizard--step-forms)); unify input/button height and states.
**Benefit:** Directly reduces daily operational friction across every team that creates orders, customers, payments, and purchase orders.
**Estimated time:** 3–4 weeks
**Impact:** Very High · **Complexity:** High

### Phase 3 — Orders, Customers, Shipping

**Goal:** Order Details sectioned redesign ([§4.7](#47-order-details-page)); Customer Profile redesign ([§4.8](#48-customer-profile)); DataGrid upgrades ([§4.6](#46-professional-tables-datagrid)) applied across Orders/Customers/Shipping tables; breadcrumbs; sidebar active-state treatment.
**Benefit:** Upgrades the core day-to-day workflow screens, not just their entry forms.
**Estimated time:** 2–3 weeks
**Impact:** Very High · **Complexity:** Medium-High

### Phase 4 — Dashboard, Analytics, Finance

**Goal:** KPI card upgrade ([§4.4](#44-kpi-cards)); chart polish (gridlines, tooltips, legends) across `SalesChart`, `StatusChart`, `Sparkline`; Finance tab hierarchy cleanup; semantic icon coloring rollout ([§4.5](#45-semantic-icon-coloring)).
**Benefit:** Raises the "first impression" surfaces (Dashboard) and the surfaces shown to financial stakeholders (Finance/Analytics), now that the higher-frequency Forms/Orders work is done.
**Estimated time:** 2 weeks
**Impact:** High · **Complexity:** Medium

### Phase 5 — Accessibility, Animations, Responsive, Final Polish

**Goal:** Sitewide focus-visible audit; `prefers-reduced-motion` support; responsive fix for the identified zero-breakpoint files (5 Settings panels, Login/Register, Onboarding); micro-interactions (hover/press transitions) applied globally; toast/skeleton motion; command palette discoverability; final RTL visual QA pass.
**Benefit:** Closes every remaining compliance and consistency gap; the last mile between "redesigned" and "shippable."
**Estimated time:** 1.5–2 weeks
**Impact:** High (compliance + polish) · **Complexity:** Low-Medium

**Total estimated time:** ~10–12.5 weeks for one designer + one frontend engineer working full-time; compressible to ~7–8 weeks with a two-person frontend pair working in parallel once Phase 1 lands (since every later phase depends on it).

---

## 7. Competitive Benchmark

| Criterion                                     | Cadeau (current)           | Shopify    | Stripe                            | HubSpot                |
| --------------------------------------------- | -------------------------- | ---------- | --------------------------------- | ---------------------- |
| Centralized type scale                        | ❌ Missing                 | ✅         | ✅                                | ✅                     |
| Shadow / elevation system                     | ❌ Missing                 | ✅         | ✅                                | ✅                     |
| Breadcrumbs                                   | ❌ Missing                 | ✅         | ✅                                | ✅                     |
| Interactive charts (tooltip/legend)           | ❌ Missing                 | ✅         | ✅                                | ✅                     |
| Unified dialog system                         | ❌ Missing (ad hoc widths) | ✅         | ✅                                | ✅                     |
| Wizard/step forms for complex creation        | ❌ Missing                 | ✅         | ✅ (Checkout, Connect onboarding) | ✅                     |
| KPI cards with trend/comparison               | ❌ Missing                 | ✅         | ✅ (best-in-class)                | ✅                     |
| Command palette (⌘K)                          | ⚠️ Present, undiscoverable | ❌         | ⚠️ Partial                        | ❌                     |
| Native RTL/Arabic support                     | ✅ Strong                  | ⚠️ Partial | ⚠️ Partial                        | ⚠️ Partial             |
| Unified state machine (loading/error/empty)   | ✅ Consistent              | ✅         | ✅                                | ⚠️ Partial             |
| Micro-interactions / motion                   | ❌ Nearly absent           | ✅         | ✅ (very strong)                  | ✅                     |
| Custom date picker                            | ❌ Native only             | ✅         | ✅                                | ✅                     |
| Sectioned record detail view (Order/Customer) | ❌ Flat tabs               | ✅         | ✅                                | ✅ (deal/contact view) |

**The real gap is not architectural** — it's the polish layer: shadows, motion, chart detail, breadcrumbs, and — as this revision highlights — **form quality**. On architecture (state machine, RTL, Desktop/Mobile shell split), Cadeau is already at or ahead of these products in one category specifically: depth of RTL/Arabic support.

---

## 8. What's Already Working

Not everything is a gap. These are worth explicitly protecting during the redesign — don't rebuild what's already correct:

- **Genuine first-class RTL/Arabic support** — logical CSS properties (`border-e`, `ms-1.5`, `text-end`) instead of hardcoded left/right, deliberate `dir="ltr"` for numerals inside RTL context, `Noto Sans Arabic` in the font stack. This is rare even in SaaS products that claim RTL support.
- **A consistent state-machine pattern** (`loading / error / empty / ready`) applied disciplined across Orders, Dashboard, Customers, and more — a clean foundation that makes every visual improvement in this roadmap cheaper to build.
- **A genuinely organized shared component layer** — one `DataGrid` powers every table page (sort, multi-select, infinite scroll, keyboard roving focus); the `EmptyState`/`ErrorState`/`LoadingState` trio is used consistently instead of one-off solutions per page.
- **A working command palette (⌘K)** built on `cmdk` — a power-user feature rare at this stage of a CRM's maturity.
- **A clear, enforced brand decision** — an explicit code comment prevents any accent color beyond the monochrome red brand system ("no gold, no foreign accent color") — rare discipline that prevents visual drift over time.
- **Deliberate privacy-conscious UX** — customer phone numbers are masked in list views and only revealed on explicit request, a conscious design decision rather than a default.
- **Permissions built into the UI layer** (`FeatureGate`/`PermissionGate`) instead of inconsistent conditional hiding — prevents "broken-looking" UI states for users with different permission levels.

**Conclusion:** the foundation is solid enough to support an intensive visual investment without risk — no structural rebuild is required, only the polish layer (and, per this revision, the forms layer) described above.

---

## 9. Effort-Based Summary

### Quick Wins (1–2 days each)

- [ ] Global `:focus-visible` ring at the root level
- [ ] Increase card padding from 16px → 24px
- [ ] Sidebar active-item accent bar (3px)
- [ ] Unify input/button/select height to 40px
- [ ] Semantic icon color mapping for existing `StatusBadge` (no new component)
- [ ] "Showing X of Y" counter above DataGrid tables
- [ ] Visual affordance for the ⌘K command palette in the topbar
- [ ] Shimmer skeleton loading (replace flat gray placeholder)
- [ ] Toast entrance/exit animation (slide + fade)

### Medium Improvements (1–2 weeks each)

- [ ] Full typography + spacing + shadow token system (Phase 1)
- [ ] Unified Dialog system with 5 standard sizes (Phase 2, structural part)
- [ ] Breadcrumb component + rollout across the app
- [ ] DataGrid upgrades: sticky header, column resize/visibility, density toggle, row-height standardization
- [ ] KPI card upgrade (trend, comparison, sparkline, icon, color coding)
- [ ] Chart polish (gridlines, tooltips, legends) across Dashboard/Analytics
- [ ] Combobox and Date Picker components
- [ ] Responsive fix for the 9 zero-breakpoint files (Settings panels, Auth, Onboarding, Orders create form)

### Major Redesigns (1–2 months)

- [ ] All 10 priority forms rebuilt to Shopify/Stripe/Linear quality ([§4.1](#41-forms-top-priority))
- [ ] Create Order rebuilt as a 5-step wizard ([§4.3](#43-wizard--step-forms))
- [ ] Order Details page restructured into sections ([§4.7](#47-order-details-page))
- [ ] Customer Profile restructured into a relationship-centric view ([§4.8](#48-customer-profile))
- [ ] Full sitewide accessibility + motion + responsive QA pass (Phase 5)

---

_This document supersedes the phase ordering of the original Design Audit while preserving all of its scoring, findings, and design-system specification. No code, API, or database changes were made or implied in producing this document._
