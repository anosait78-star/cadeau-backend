# EPIC-6 Quality Gate (§2.5) — Extensible Core / Event Bus

**Epic:** EPIC-6 Extensible Core (ADR-0004) · **Branch:** `feat/epic-6-core`
· **Gate run:** 2026-07-30.

The mandatory post-epic quality gate: Security · Architecture · Code · Testing ·
Performance · API/Contract · Documentation · Extensibility · AI-out guarantee —
plus **owner approval**. No new epic starts until every dimension passes and the
owner signs off.

---

## 0. Gate summary

| Dimension         | Result  | Note                                                                          |
| ----------------- | :-----: | ----------------------------------------------------------------------------- |
| Security          | ✅ PASS | Emission is additive to the durable audit write; payloads secret-free         |
| Architecture      | ✅ PASS | Global bus behind a port; no cross-feature imports; `arch:check` clean        |
| Code              | ✅ PASS | Typed closed catalog; subscriber isolation; strict TS, no `any`               |
| Testing           | ✅ PASS | 391 unit/integration green; +9 bus, +3 emitter assertions                     |
| Performance       | ✅ PASS | In-process sync dispatch, O(subscribers); web bundle unchanged (141.8 KB)     |
| API / Contract    | ✅ PASS | [events.md](events.md) catalog + contract; access.md "Events emitted" updated |
| Documentation     | ✅ PASS | events.md, extensibility.md, architecture-tests.md, this gate                 |
| Extensibility     | ✅ PASS | Three seams documented; `ExtensionPoint` described; no dynamic loading        |
| AI-out (ADR-0004) | ✅ PASS | `no-ai-imports` guard fails on any AI import; `ai` feature inactive           |

**Local gates (this run):** `format:check` ✅ · `lint` ✅ · `type-check` ✅ (8/8) ·
`test` ✅ **391 passed** (config 37 · web 74 · crypto 25 · database 67 · api 188) ·
`build` ✅ (5/5) · `arch:check` ✅ (327 modules, 705 deps, 0 violations) ·
`check-stable-only` ✅ · `audit --audit-level high` ✅ (0 high; 1 moderate, under the
gate threshold) · `perf:bundle` ✅ (`@cadeau/web` 141.8 KB / 200 KB gzip).

**CI-only gates:** `database`, `e2e`, `performance`, `api-load`, `sast`,
secret-scan — run on push/PR to `main`. No schema/migration or UI change in this
epic, so `database`/`e2e`/`performance` carry over EPIC-5's evidence unchanged;
the new `no-ai-imports` rule runs in the existing `architecture` job.

---

## 1. Security review

- **Emission is additive.** Each access mutation still writes the durable,
  append-only `audit_log` row (source of truth) **and then** publishes on the
  bus. A failed/absent subscriber cannot lose or alter the audit record.
- **Subscriber isolation.** A throwing or rejecting handler is caught, logged,
  and skipped — it cannot break the publisher, skip peers, or leak an error to
  the caller. No unhandled rejection escapes `publish`.
- **Payloads are secret-free** by contract (same rule as the audit log) — ids,
  keys, flags, plan codes only. They may be logged and, later, queued.
- **No new dependency, no new attack surface.** Pure in-process TypeScript; the
  `no-ai-imports` guard _reduces_ the allowable surface. `audit`/`stable-only`
  clean.

**Result: PASS.**

## 2. Architecture review

- **One bus, behind a port.** `EventBusPort` (`EVENT_BUS` token) with a single
  `InProcessEventBus` implementation, wired by a `@Global` `EventBusModule`.
  Publishers/subscribers depend on the port, not the implementation.
- **Boundaries intact.** Modules emit/subscribe through the shared bus instead of
  importing siblings; `no-cross-feature-imports` still clean. The bus lives in
  `shared/`, depends only on `shared/logging`.
- **`arch:check` green:** 327 modules, 705 deps, 0 violations — with the new
  `no-ai-imports` rule active.

**Result: PASS.**

## 3. Code review

- **Closed, typed catalog** (`event-catalog.ts`): a discriminated payload map;
  the compiler rejects an unknown type or a mis-shaped payload at publish and
  subscribe. Live events fully specified; future ones forward-declared and
  labelled with their owning epic.
- **Isolation logic is small and total** — snapshot-then-iterate so a handler
  that (un)subscribes mid-dispatch can't disturb the in-flight publish; per-handler
  try/catch; idempotent unsubscribe.
- TypeScript strict, `readonly` envelope/payloads, no `any`, no `process.env`.

**Result: PASS.**

## 4. Testing

- **391 tests pass** (+9 bus, +3 emitter publish-assertions this epic). Bus
  coverage: delivery to all subscribers, type isolation, no-op on empty, async
  await ordering, throwing- and rejecting-handler isolation with logging,
  unsubscribe (incl. idempotent and mid-dispatch self-removal). Emitters assert
  the exact published event alongside the retained audit + cache assertions.
- Full-catalog payload typing is compile-time enforced (type-check gate).

**Result: PASS.**

## 5. Performance

- **Synchronous in-process dispatch**, O(number of subscribers) per publish, no
  I/O in the bus itself. Emission happens after the durable write, adding only
  the subscriber work (today: none registered — the access events have no
  in-process consumer yet, so publish is a Map lookup + no-op).
- **Decision recorded: sync-now.** Durable async queue/retry (notification
  fan-out) is deferred to EPIC-15 behind the same port — see [events.md](events.md) §1, §7.
- Web bundle unchanged (backend-only epic): 141.8 KB / 200 KB gzip.

**Result: PASS.**

## 6. API / contract review

- [events.md](events.md) documents the port, envelope, the closed catalog (live +
  forward-declared), publish/subscribe usage, and the "adding an event" checklist.
- [api/access.md](api/access.md) "Events emitted (ADR-004)" now points at the live
  bus and states the additive-to-audit relationship. No HTTP contract changed —
  the bus is internal.

**Result: PASS.**

## 7. Documentation review

- [events.md](events.md), [extensibility.md](extensibility.md),
  [architecture-tests.md](architecture-tests.md) (`no-ai-imports` section), and
  this gate are complete. [execution-plan.md](execution-plan.md) §0 + the EPIC-6
  section reflect delivery.

**Result: PASS.**

## 8. Extensibility review (ADR-0004)

- Three real seams documented — event bus, feature catalog, permission catalog —
  with a described `ExtensionPoint` contract and **no dynamic code loading** in
  v1.0. A future module / paid add-on / AI plugin attaches through these without
  core changes. Enforced indirectly by `no-cross-feature-imports` +
  extensible-by-data access model.

**Result: PASS.**

## 9. AI-out guarantee (ADR-0004)

- **`no-ai-imports` architecture rule** fails the build on any AI SDK / hosted-
  inference import — including **unresolved** and **type-only** ones — across the
  documented package families. **Verified:** a planted `openai` import failed the
  gate; removing it returns the tree to clean. The `ai` feature is seeded
  **inactive**; no AI permission, endpoint, or dependency exists.

**Result: PASS.**

---

## Owner approval

All dimensions **PASS**; all local gates green; CI-only gates wired.

- [x] **Owner approval to begin EPIC-6 implementation** — directed 2026-07-30
      (recorded in [epic-5-quality-gate.md](epic-5-quality-gate.md)).
- [ ] **Owner approval to close EPIC-6 and begin EPIC-7 (Master Data).** Pending
      owner sign-off.

> **EPIC-6 status: complete, pending the closure checkbox above.** Backend-only;
> no migration or UI change. If Docker/CI is available on the owner's side, run
> the CI-only gates to complete the evidence set.
