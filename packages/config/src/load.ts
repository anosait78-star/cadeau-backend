import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as dotenv from "dotenv";
import { ConfigValidationError } from "./errors";
import { resolveNodeEnv, selectEnvFiles } from "./environment";
import { envSchema } from "./schema";
import { buildConfig } from "./build-config";
import type { AppConfig } from "./types";

export interface LoadConfigOptions {
  /** Inject a raw environment record (used by tests); bypasses process.env and dotenv. */
  readonly env?: Record<string, string | undefined>;
  /** Working directory used to resolve dotenv files. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /** Skip loading dotenv files (rely solely on process.env). */
  readonly skipDotenv?: boolean;
}

function loadEnvFiles(cwd: string, files: readonly string[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const file of files) {
    const path = resolve(cwd, file);
    if (!existsSync(path)) continue;
    Object.assign(merged, dotenv.parse(readFileSync(path)));
  }
  return merged;
}

/**
 * Load, validate, and structure the application configuration.
 *
 * Throws {@link ConfigValidationError} — refusing to boot — when any required
 * variable is missing or any value is invalid. Files never override
 * platform-injected variables: `process.env` wins over dotenv files.
 */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  let raw: Record<string, string | undefined>;
  if (options.env !== undefined) {
    raw = options.env;
  } else {
    const nodeEnv = resolveNodeEnv(process.env);
    const cwd = options.cwd ?? process.cwd();
    const fileVars = options.skipDotenv === true ? {} : loadEnvFiles(cwd, selectEnvFiles(nodeEnv));
    raw = { ...fileVars, ...process.env };
  }

  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
        message: issue.message,
      })),
    );
  }

  return buildConfig(result.data);
}
