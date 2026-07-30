# Extensibility — how the core grows without changing the core

**Status:** Described (EPIC-6, M6.3) · **ADR:** [0004 AI-out / Extensible](adr/README.md)
· **Related:** [events.md](events.md), [architecture-tests.md](architecture-tests.md),
[api/access.md](api/access.md)

ADR-0004 requires the core to be **extension-ready by description** — the seams a
future first-party module, a paid add-on, or (only ever behind a new ADR) an AI
plugin would attach to must exist and be documented, **without any dynamic code
loading in v1.0**. Nothing here loads code at runtime. Extensions are ordinary,
statically-linked modules that plug into three existing seams. This document is
the map of those seams.

> **No runtime plugin loading in v1.0.** There is no plugin loader, no
> `eval`, no reading modules from disk or the network. "Registry" below means a
> _described contract_ an extension conforms to, wired at build time through the
> normal NestJS module graph — not a dynamic host. This keeps the attack surface
> and the dependency posture (ADR-0001) fixed and auditable.

---

## 1. The three seams

Everything a well-behaved extension needs, it gets by combining these. None of
them requires editing existing feature code.

| Seam                   | What it lets an extension do                                 | Where it lives                                                                         |
| ---------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| **Event bus**          | React to domain facts (subscribe) and announce its own       | [`shared/events`](../apps/api/src/shared/events/) · [events.md](events.md)             |
| **Feature catalog**    | Add a gate the three-layer access model resolves against     | [`seed/access/catalog.ts`](../packages/database/src/seed/access/catalog.ts) `FEATURES` |
| **Permission catalog** | Add permissions (feature-gated) and grant them via templates | same `catalog.ts` — `PERMISSIONS`, `FEATURE_PERMISSIONS`, `TEMPLATES`                  |

### 1.1 Event subscribers

An extension reacts to the core by subscribing to catalog events — it never
imports a sibling feature. Publishing its own events (added to the catalog) lets
_other_ extensions react to it in turn. See [events.md](events.md) §5–§6.

### 1.2 Feature-catalog entries

A new capability area is a new `FeatureDef` row. Because access resolves
`Subscription ∧ Feature-Flag ∧ Permission`, adding the feature key is all it
takes for the platform to gate it — plans include it, Super-Admin toggles it per
company, and the global `active` flag is its kill switch. A feature that ships
**inactive** (`active: false`) is present but off until deliberately enabled —
exactly how the `ai` feature ships (see §3).

### 1.3 Permission additions

A feature contributes a `read`/`manage` (or finer) permission pair, edges linking
each permission to its gating feature (`FEATURE_PERMISSIONS`), and template grants
(`TEMPLATES`). The resolver already enforces that **a permission never outlives
its feature** ([permission-matrix.md](permission-matrix.md)), so a new permission
is automatically dark until its feature is on.

## 2. The extension-point registry (described contract)

An extension is a NestJS module that declares, in one place, what it contributes
to each seam. This is the shape it conforms to — a **description**, statically
wired, not a runtime host:

```ts
interface ExtensionPoint {
  /** Stable identifier, e.g. "core.orders", "addon.loyalty". */
  readonly id: string;
  /** Feature-catalog rows this extension owns (may ship inactive). */
  readonly features?: readonly FeatureDef[];
  /** Permissions + their feature edges + template grants. */
  readonly permissions?: readonly PermissionContribution[];
  /** Event subscriptions registered on module init, each returning an Unsubscribe. */
  readonly subscriptions?: readonly EventSubscription[];
}
```

- **Catalog contributions** (`features`, `permissions`) are merged into the
  seed catalog and applied by the idempotent seeders — the same path the core
  features use. No migration to the access schema is needed; the model is
  **extensible by data** (ADR-0003).
- **Subscriptions** are registered through the `EVENT_BUS` port in the module's
  lifecycle. Isolation is guaranteed by the bus, so a faulty extension cannot
  break the publisher.
- **Wiring** is a normal `imports: [MyExtensionModule]` in the composition root.
  There is no discovery, no scanning of `node_modules`, no dynamic import.

## 3. AI as a described (inactive) extension — ADR-0004

AI is the canonical example of an extension that is **fully described but not
present**:

- The `ai` feature is **seeded inactive** (`active: false` in `catalog.ts`), so
  the gate exists and stays off. Turning it on would still expose nothing —
  there is no AI permission, endpoint, or dependency.
- The [`no-ai-imports`](architecture-tests.md#no-ai-imports-adr-0004) architecture
  rule **fails the build** on any AI SDK / hosted-inference import, so AI cannot
  sneak in through a dependency — not even a type-only one, not even before the
  package is installed. Every "smart" path in v1.0 is deterministic (order
  smart-paste is Regex/heuristics, analytics deltas are computed queries).
- If AI is ever adopted it arrives **as a paid add-on** through exactly these
  seams: activate the `ai` feature, add `ai.*` permissions gated by it, subscribe
  to the relevant domain events, and gate the add-on's endpoints by the
  three-layer check — introduced by a **new ADR** that supersedes the AI-out
  stance, never by quietly adding a dependency.

## 4. What stays closed

- **No dynamic code loading / no plugin marketplace runtime** in v1.0.
- **No new external auth/crypto/AI dependency** without an ADR (ADR-0001/0004);
  the audit and stable-only gates enforce the dependency posture.
- **No cross-feature imports** — extensions talk through the three seams only,
  enforced by the `no-cross-feature-imports` architecture rule.

Every extension therefore composes from a fixed, auditable set of seams. The core
never learns about a specific extension; it only exposes the contracts above.
