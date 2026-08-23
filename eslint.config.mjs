// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

/**
 * Root ESLint flat config for the Cadeau CRM monorepo.
 * Per-package configs extend this and enable type-aware rules with their own tsconfig.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/.lighthouseci/**",
      "**/.lighthouseci-mobile/**",
      // k6 load scripts run in the k6 (Go/goja) runtime, not Node/browser — they
      // use k6-specific imports and globals (`__ENV`) and are linted by k6 itself.
      "perf/k6/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // ADR-001 / Coding Standards §3.1: no console in production code.
      "no-console": ["error", { allow: ["warn", "error"] }],
      // M1.3 requirement #4: configuration must be read through @cadeau/config,
      // never process.env directly (the config package is the only exception).
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Read configuration via @cadeau/config, not process.env directly.",
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      eqeqeq: ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
    },
  },
  // Config files and tooling scripts run on Node and may use console freely.
  {
    files: ["**/*.config.{js,mjs,cjs,ts}", "**/*.cjs", "scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-console": "off",
      "no-restricted-properties": "off",
    },
  },
  // The web app's service worker runs in the ServiceWorkerGlobalScope, not the
  // window: it needs the worker globals (`self`, `caches`, `fetch`), and it is a
  // plain asset served from public/, not part of the bundled TypeScript sources.
  {
    files: ["apps/web/public/*.js"],
    languageOptions: {
      globals: { ...globals.serviceworker },
    },
  },
  // The configuration package is the single, authorized reader of process.env.
  {
    files: ["packages/config/src/**/*.ts"],
    rules: {
      "no-restricted-properties": "off",
    },
  },
  // Prisma seed/CLI scripts are operational tooling run via tsx; they log
  // progress to the console. Config still comes from @cadeau/config, so the
  // process.env restriction stays in force.
  {
    files: ["**/prisma/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-console": "off",
    },
  },
  // NestJS (apps/api) uses decorator-based dependency injection, which relies on
  // `emitDecoratorMetadata`: a constructor-injected class MUST be a *value*
  // import, or the DI metadata degrades to `Object` and injection fails at
  // runtime. `consistent-type-imports` cannot tell an injected class from a
  // plain type and its autofix silently breaks DI, so we disable it here.
  {
    files: ["apps/api/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
  prettier,
);
