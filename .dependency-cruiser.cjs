// @ts-check
/**
 * Architecture tests (dependency-cruiser) — Cadeau CRM monorepo.
 *
 * These rules are the *executable* form of our architecture. They fail the build
 * (locally via `pnpm arch:check` and in CI via the `architecture` job) whenever a
 * change introduces a structural violation, so drift is caught the moment it is
 * written — not at review time.
 *
 * They enforce four families of constraint (see docs/architecture-tests.md):
 *   1. No circular dependencies.
 *   2. No layer violations (dependencies point inward: presentation → application
 *      → domain; infrastructure → domain; domain depends on nothing outward).
 *   3. No forbidden imports (e.g. data access outside the infrastructure layer;
 *      reaching into another package's internals; production code importing tests).
 *   4. No direct cross-feature imports (feature slices talk via shared contracts,
 *      never by reaching into a sibling feature).
 *
 * The intended source layout the rules assume (established in M1.5+):
 *
 *   apps/api/src/
 *     main.ts                         # bootstrap (composition root)
 *     app.module.ts                   # root wiring (composition root)
 *     modules/<feature>/
 *       domain/                       # pure: entities, value objects, ports (interfaces)
 *       application/                  # use-cases/services orchestrating the domain
 *       infrastructure/               # adapters: Prisma repositories, external clients
 *       presentation/                 # controllers, DTOs, mappers (HTTP)
 *       <feature>.module.ts           # NestJS module = composition root for the feature
 *     shared/                         # cross-cutting: guards, filters, interceptors, decorators
 *       contracts/                    # the ONLY sanctioned cross-feature contact surface
 *
 * Rules that key off apps/api match nothing until that code exists, so this config
 * is safe to land before the first NestJS module and activates automatically.
 */

// Files that are tests/tooling and therefore are not subject to the structural
// (layer / cross-feature / data-access) rules — but may not be imported BY
// production code (see `no-prod-code-to-test`).
const TEST_OR_SPEC = "\\.(spec|test)\\.[cm]?[tj]sx?$|(^|/)(__tests__|__mocks__|test|tests|e2e)/";

// NestJS composition roots: the only places allowed to wire layers together and
// therefore exempt from the inward-only layer rules.
const COMPOSITION_ROOT = "(^|/)(main|app\\.module)\\.[cm]?ts$|(^|/)[^/]+\\.module\\.[cm]?ts$";

// AI SDK / hosted-inference client package families (ADR-0004: no AI in v1.0).
// Matched as a path segment so a bare unresolved specifier (`openai`) and an
// installed one (`node_modules/openai/...`) both hit, and unrelated names that
// merely contain the substring (e.g. `cohere-utils`) do not. Type-only imports
// are included on purpose — a type dependency still means the SDK is present.
const AI_PACKAGES =
  "(^|/)(" +
  [
    "@anthropic-ai/", // Claude SDK
    "openai(/|$)", // OpenAI
    "@azure/openai(/|$)", // Azure OpenAI
    "@google/generative-ai(/|$)", // Google Gemini (legacy)
    "@google/genai(/|$)", // Google Gemini (GA)
    "@google-cloud/vertexai(/|$)", // Vertex AI
    "@mistralai/", // Mistral
    "mistralai(/|$)",
    "@langchain/", // LangChain
    "langchain(/|$)",
    "llamaindex(/|$)", // LlamaIndex
    "cohere-ai(/|$)", // Cohere
    "@huggingface/", // Hugging Face
    "replicate(/|$)", // Replicate
    "groq-sdk(/|$)", // Groq
    "ollama(/|$)", // Ollama
    "@aws-sdk/client-bedrock-runtime(/|$)", // AWS Bedrock inference
  ].join("|") +
  ")";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ---------------------------------------------------------------- circular
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Circular dependencies make code impossible to reason about, break " +
        "tree-shaking, and cause non-deterministic init order. Break the cycle " +
        "(extract a shared abstraction or invert the dependency).",
      from: {},
      to: { circular: true },
    },

    // ------------------------------------------------ cross-feature boundaries
    {
      name: "no-cross-feature-imports",
      severity: "error",
      comment:
        "A feature slice must not import directly from a sibling feature. " +
        "Features communicate only through apps/api/src/shared/contracts " +
        "(shared DTOs/events/ports). Direct coupling defeats modular boundaries.",
      from: {
        path: "^apps/api/src/modules/([^/]+)/",
        pathNot: TEST_OR_SPEC,
      },
      to: {
        path: "^apps/api/src/modules/([^/]+)/",
        // Same feature is fine; a different feature ($1 back-reference) is not.
        pathNot: "^apps/api/src/modules/$1/",
      },
    },

    // -------------------------------------------------------- layer violations
    // Dependencies point inward only. Composition roots (*.module.ts, main.ts)
    // are exempt because wiring layers together is their job.
    {
      name: "layer-domain-is-pure",
      severity: "error",
      comment:
        "The domain layer is the core: it must not depend on application, " +
        "infrastructure, or presentation. Keep it framework- and IO-free.",
      from: {
        path: "^apps/api/src/modules/[^/]+/domain/",
        pathNot: TEST_OR_SPEC,
      },
      to: {
        path: "^apps/api/src/modules/[^/]+/(application|infrastructure|presentation)/",
      },
    },
    {
      name: "layer-application-no-outer",
      severity: "error",
      comment:
        "The application layer may use the domain but must not depend on " +
        "infrastructure or presentation (depend on ports, not adapters).",
      from: {
        path: "^apps/api/src/modules/[^/]+/application/",
        pathNot: TEST_OR_SPEC,
      },
      to: {
        path: "^apps/api/src/modules/[^/]+/(infrastructure|presentation)/",
      },
    },
    {
      name: "layer-presentation-no-infrastructure",
      severity: "error",
      comment:
        "Presentation (controllers/DTOs) must go through the application layer, " +
        "never reach into infrastructure adapters directly.",
      from: {
        path: "^apps/api/src/modules/[^/]+/presentation/",
        pathNot: TEST_OR_SPEC,
      },
      to: {
        path: "^apps/api/src/modules/[^/]+/infrastructure/",
      },
    },

    // ------------------------------------------------------- forbidden imports
    {
      name: "no-ai-imports",
      severity: "error",
      comment:
        "ADR-0004 (AI-out / Extensible): the v1.0 core ships with NO AI. No " +
        "module may import an AI SDK or hosted-inference client — order parsing, " +
        "analytics deltas, and every 'smart' path are deterministic (Regex / " +
        "heuristics / computed queries). The 'AI' feature is a described, inactive " +
        "extension point (docs/extensibility.md), not a runtime dependency. If AI " +
        "is ever adopted it arrives as a paid add-on behind the event bus + " +
        "feature catalog — via a new ADR, never by adding a dependency here.",
      from: {},
      to: { path: AI_PACKAGES },
    },
    {
      name: "data-access-only-in-infrastructure",
      severity: "error",
      comment:
        "Prisma / @cadeau/database is a persistence detail. Only the " +
        "infrastructure layer (and composition roots wiring a PrismaModule) may " +
        "import it — never domain, application, or presentation. Depend on ports.",
      from: {
        path: "^apps/api/src/",
        pathNot: ["^apps/api/src/modules/[^/]+/infrastructure/", COMPOSITION_ROOT, TEST_OR_SPEC],
      },
      to: {
        path: "node_modules/(@prisma/client|\\.prisma)|(^|/)@cadeau/database",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "no-deep-package-internals",
      severity: "error",
      comment:
        "Import a workspace package by its public name (e.g. @cadeau/config), " +
        "never by reaching into another package's src/. Cross-package deep paths " +
        "bypass the package's public API and its build output.",
      from: { path: "^packages/([^/]+)/", pathNot: TEST_OR_SPEC },
      to: {
        path: "^packages/([^/]+)/src/",
        pathNot: "^packages/$1/",
      },
    },
    {
      name: "app-imports-package-by-name",
      severity: "error",
      comment:
        "Apps must import workspace packages by their public name (@cadeau/*), " +
        "not by reaching into packages/<name>/src/.",
      from: { path: "^apps/", pathNot: TEST_OR_SPEC },
      to: { path: "^packages/[^/]+/src/" },
    },
    {
      name: "packages-do-not-depend-on-apps",
      severity: "error",
      comment:
        "Lower-level workspace packages must never depend on an app — the " +
        "dependency arrow points from apps to packages, not the reverse.",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "no-prod-code-to-test",
      severity: "error",
      comment:
        "Production code must not import test/spec/mock modules. Test helpers " +
        "belong to the test graph only.",
      from: { pathNot: TEST_OR_SPEC },
      to: { path: TEST_OR_SPEC },
    },
  ],

  options: {
    // Resolve TypeScript path aliases and honour the strict base settings.
    tsConfig: { fileName: "tsconfig.base.json" },
    // Follow dependencies through .ts before compilation (pre-compilation deps),
    // so the graph reflects source imports including type-only ones.
    tsPreCompilationDeps: true,
    // Don't traverse into third-party code; we only test our own boundaries.
    doNotFollow: { path: "node_modules" },
    // Keep build artifacts and coverage out of the graph entirely.
    exclude: {
      path: "(^|/)(dist|build|coverage|\\.turbo|node_modules)/",
    },
    enhancedResolveOptions: {
      // Prefer the "types" / package entry points that the workspace uses.
      exportsFields: ["exports"],
      conditionNames: ["types", "import", "require", "node", "default"],
      mainFields: ["types", "module", "main"],
      extensions: [".ts", ".tsx", ".js", ".cjs", ".mjs", ".json"],
    },
    // Stable, machine-checkable output; the `err` reporter is used in CI.
    progress: { type: "none" },
  },
};
