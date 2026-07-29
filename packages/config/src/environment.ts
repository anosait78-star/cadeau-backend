import { ConfigValidationError } from "./errors";

/**
 * The four explicitly supported runtime environments (Environment Separation, M1.3).
 */
export const NODE_ENVIRONMENTS = ["development", "test", "staging", "production"] as const;

export type NodeEnv = (typeof NODE_ENVIRONMENTS)[number];

export function isNodeEnv(value: unknown): value is NodeEnv {
  return typeof value === "string" && (NODE_ENVIRONMENTS as readonly string[]).includes(value);
}

/**
 * Resolve and validate NODE_ENV from a raw source. NODE_ENV must be set
 * explicitly to one of the four supported values — never inferred — so that a
 * production configuration can never be selected by accident.
 */
export function resolveNodeEnv(source: Record<string, string | undefined>): NodeEnv {
  const raw = source["NODE_ENV"];
  if (raw === undefined || raw.trim() === "") {
    throw new ConfigValidationError([
      {
        path: "NODE_ENV",
        message: `is required; set it to one of: ${NODE_ENVIRONMENTS.join(", ")}`,
      },
    ]);
  }
  if (!isNodeEnv(raw)) {
    throw new ConfigValidationError([
      {
        path: "NODE_ENV",
        message: `"${raw}" is invalid; allowed: ${NODE_ENVIRONMENTS.join(", ")}`,
      },
    ]);
  }
  return raw;
}

/**
 * Ordered list of dotenv files to load for a given environment.
 *
 * Only the file matching the active environment is ever selected, so a
 * `.env.production` file is never loaded outside production — this is the
 * mechanism that prevents using production configuration during development.
 */
export function selectEnvFiles(nodeEnv: NodeEnv): readonly string[] {
  return [".env", `.env.${nodeEnv}`, `.env.${nodeEnv}.local`];
}
