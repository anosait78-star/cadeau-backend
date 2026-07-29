import type { AppConfig } from "@cadeau/config";

/**
 * DI token for the validated, structured application configuration.
 * Inject with `@Inject(APP_CONFIG)` — no module ever reads `process.env`
 * directly; `@cadeau/config` is the single source of truth (M1.3).
 */
export const APP_CONFIG = Symbol("APP_CONFIG");

/** Convenience alias for the injected configuration type. */
export type InjectedAppConfig = AppConfig;
