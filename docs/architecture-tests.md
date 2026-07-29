# Architecture Tests

Architecture tests are the **executable form of our architecture**. They fail the
build the moment a change introduces a structural violation — locally via
`pnpm arch:check` and in CI via the `architecture` job — so boundary erosion is
caught when it is written, not discovered months later at review or in a refactor.

They are intentionally in place **before the first NestJS module** (M1.5), so the
very first line of feature code is written inside a fence that is already
enforced.

- Tool: [`dependency-cruiser`](https://github.com/sverweij/dependency-cruiser) `18.1.0` (stable, ADR-001).
- Rules: [`.dependency-cruiser.cjs`](../.dependency-cruiser.cjs)
- Runner: [`scripts/check-architecture.mjs`](../scripts/check-architecture.mjs)
- Command: `pnpm arch:check`
- CI: `.github/workflows/ci.yml` → **`architecture`** job.

## What is enforced

The rules cover the four families of constraint requested for the foundation:

| #   | Constraint                                          | Rule(s)                                                                                                                                                    |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **No circular dependencies**                        | `no-circular`                                                                                                                                              |
| 2   | **No layer violations** (dependencies point inward) | `layer-domain-is-pure`, `layer-application-no-outer`, `layer-presentation-no-infrastructure`                                                               |
| 3   | **No forbidden imports**                            | `data-access-only-in-infrastructure`, `no-deep-package-internals`, `app-imports-package-by-name`, `packages-do-not-depend-on-apps`, `no-prod-code-to-test` |
| 4   | **No direct cross-feature imports**                 | `no-cross-feature-imports`                                                                                                                                 |

Every rule is `severity: error` — there are no warnings to ignore.

## The architecture the rules assume

The layer and cross-feature rules key off this source layout, established from
M1.5 onward. Rules that reference `apps/api/...` simply match nothing until that
code exists, then activate automatically — no config change needed.

```
apps/api/src/
  main.ts                     # bootstrap            ┐ composition roots:
  app.module.ts               # root wiring          │ exempt from layer rules
  modules/<feature>/
    <feature>.module.ts       # feature wiring       ┘ (wiring layers is their job)
    domain/                   # entities, value objects, ports (interfaces) — pure, no IO
    application/              # use-cases/services orchestrating the domain via ports
    infrastructure/          # adapters: Prisma repositories, external clients
    presentation/            # controllers, DTOs, mappers (HTTP)
  shared/
    contracts/               # the ONLY sanctioned cross-feature contact surface
```

### Layer direction (inward only)

```
presentation ──▶ application ──▶ domain ◀── infrastructure
                                   ▲
                              (depends on nothing outward)
```

- **domain** depends on nothing outward — no application, infrastructure, or
  presentation. It stays framework- and IO-free.
- **application** may use the domain but not infrastructure or presentation
  (depend on ports/interfaces, not adapters).
- **presentation** goes through application; it must not reach into infrastructure.
- **infrastructure** implements the ports the inner layers declare.
- **Composition roots** (`main.ts`, `app.module.ts`, `*.module.ts`) are exempt —
  wiring the layers together is exactly their purpose.

### Cross-feature boundary

A feature slice (`modules/<A>`) must **not** import from a sibling feature
(`modules/<B>`). Features talk only through `apps/api/src/shared/contracts`
(shared DTOs / events / ports). This keeps slices independently evolvable and is
what makes the modular / event-driven architecture in the ADRs real rather than
aspirational.

### Data access is an infrastructure detail

Only the **infrastructure** layer (and a composition root wiring a `PrismaModule`)
may import `@cadeau/database` / `@prisma/client`. Domain, application, and
presentation depend on **ports**, never on Prisma directly — so the persistence
choice stays swappable and the inner layers stay pure.

### Package boundaries

- Import a workspace package by its **public name** (`@cadeau/config`,
  `@cadeau/database`), never by reaching into its `src/`.
- **Lower-level packages never depend on apps** — the arrow points from `apps/*`
  to `packages/*`, not back.
- **Production code never imports test/spec/mock modules.**

## Running locally

```bash
pnpm arch:check
```

The runner cruises only the source roots that exist (`packages/`, and `apps/`
once it is created), so it is valid today and widens automatically as the
codebase grows. A violation prints the offending `from → to` edge and the rule
name, and exits non-zero.

## Adding or changing a rule

Edit [`.dependency-cruiser.cjs`](../.dependency-cruiser.cjs). Keep every rule at
`severity: error`, add a `comment` explaining the _why_ (it is shown on
violation), and — because these rules are guardrails — verify a new rule both
**fires on a deliberate violation** and **passes on the current tree** before
committing. A rule that never fails is not protecting anything.
