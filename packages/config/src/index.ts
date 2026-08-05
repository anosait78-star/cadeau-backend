export type {
  AppConfig,
  HttpConfig,
  HttpCorsConfig,
  LoggingConfig,
  DatabaseConfig,
  JwtConfig,
  EncryptionConfig,
  OAuthConfig,
  OAuthProviderConfig,
  ThirdPartyConfig,
} from "./types";
export { NODE_ENVIRONMENTS, isNodeEnv, resolveNodeEnv, selectEnvFiles } from "./environment";
export type { NodeEnv } from "./environment";
export { ConfigValidationError } from "./errors";
export type { ConfigIssue } from "./errors";
export { envSchema, isHttpUrl, isPostgresUrl, splitList } from "./schema";
export type { ValidatedEnv } from "./schema";
export { buildConfig, redactConfig } from "./build-config";
export { loadConfig } from "./load";
export type { LoadConfigOptions } from "./load";

import { loadConfig } from "./load";
import type { AppConfig } from "./types";

let cached: AppConfig | undefined;

/** Lazily load and cache the configuration as a process-wide singleton. */
export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

/** Clear the cached singleton. Intended for tests only. */
export function resetConfigForTesting(): void {
  cached = undefined;
}
