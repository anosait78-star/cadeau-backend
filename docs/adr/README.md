# Architecture Decision Records (ADRs)

An ADR captures a significant architectural decision: its context, the decision,
and its consequences. They are immutable once **Accepted** — a decision is changed
by writing a _new_ ADR that supersedes the old one, never by editing history.

## Process

1. Copy [`template.md`](template.md) to `NNNN-short-title.md` (next number, zero-padded).
2. Fill in Context → Decision → Consequences. Open it as `Proposed` in a PR.
3. On approval, set the status to `Accepted` and merge.
4. To change an accepted decision, write a new ADR and mark the old one
   `Superseded by ADR-XXXX` (add a link both ways).

Keep ADRs short and durable — the _why_, not an implementation manual.

## Index

| ADR                                    | Title                                                           | Status             |
| -------------------------------------- | --------------------------------------------------------------- | ------------------ |
| [0001](0001-security-first.md)         | Security First                                                  | Accepted (binding) |
| [0002](0002-mobile-first-dual-ux.md)   | Mobile-First Dual UX                                            | Accepted (binding) |
| [0003](0003-three-layer-access.md)     | Enterprise Permission & Feature Management (Three-Layer Access) | Accepted (binding) |
| [0004](0004-ai-out-extensible-core.md) | AI Out of Scope for v1.0 (AI-Ready, Extensible Core)            | Accepted (binding) |

**Binding ADRs** (0001–0004) govern every decision in the project and cannot be
overridden except by a new, approved ADR. They are distilled from
`Cadeau_CRM_Master_Product_Plan.md` and `Cadeau_CRM_Engineering_Standards.md`.
