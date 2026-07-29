# ADR-0004: AI Out of Scope for v1.0 (AI-Ready, Extensible Core)

- **Status:** Accepted (binding)
- **Date:** 2026-07-26
- **Deciders:** Product owner
- **Supersedes / Superseded by:** —

## Context

AI features are attractive but add cost, non-determinism, privacy exposure, and
vendor dependence. v1.0 must be reliable and fully deterministic, while leaving a
clean path to add AI later without reworking the core.

## Decision

**No AI-dependent feature ships in v1.0** — no AI services/screens/integrations
(Claude/OpenAI/etc.), no AI-dependent workflow.

- v1.0 runs on **100% deterministic logic**: "smart paste" = Regex/Heuristics,
  automation = rules.
- The architecture is **Modular + Event-Driven + Plugin + Extension Points**
  (documented as description only for v1.0).
- Feature flag `AI` = **OFF** by default. AI is added later as an independent
  **plugin** with no core modification (v1.2+); AI features in the backlog are
  tagged _[AI — behind flag `AI`]_.

## Consequences

- **Positive:** deterministic, testable, low-cost, privacy-preserving v1.0; AI can
  be added without touching the core.
- **Negative / trade-offs:** must build deterministic equivalents (heuristic parsing,
  rule automation) now; extension points must be designed even though unused in v1.0.
- **Follow-ups:** **EPIC-6** wires the event bus + plugin registry + extension points
  and adds a **CI check that blocks any AI SDK/service import**; `orders/parse` stays
  deterministic ([docs/api/orders.md](../api/orders.md)).

## Alternatives considered

- **Ship AI features in v1.0** — rejected: cost, non-determinism, and privacy risk
  before the core is proven.
- **Bake AI hooks into the core now** — rejected: couples the core to an uncertain
  future; a plugin boundary keeps v1.0 clean.
