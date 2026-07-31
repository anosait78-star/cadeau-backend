import { z } from "zod";
import { NODE_ENVIRONMENTS } from "./environment";

/** A boolean expressed as an environment string ("true"/"false"/"1"/"0"/"yes"/"no"). */
const zBoolean = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

/** A TCP port. */
const zPort = z.coerce.number().int().min(1).max(65535);

/** A duration such as `15m`, `7d`, `3600s`, `500ms`, or a bare number of milliseconds. */
const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)?$/;
const zDuration = z.string().refine((value) => {
  const match = DURATION_PATTERN.exec(value.trim());
  if (match === null) return false;
  return Number(match[1]) > 0;
}, "must be a positive duration like 15m, 7d, 3600s, 500ms");

/** Case-insensitive markers that must never appear in production secrets. */
const INSECURE_PLACEHOLDER =
  /(example|change[-_ ]?me|placeholder|dev[-_ ]?only|test[-_ ]?secret|replace[-_ ]?me|your[-_ ]?secret)/i;

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isPostgresUrl(value: string): boolean {
  return /^postgres(ql)?:\/\//.test(value.trim());
}

/** Split a comma-separated list into trimmed, non-empty items. */
export function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * The environment contract. Unknown variables (PATH, HOME, …) are ignored;
 * every declared variable is validated. Runtime validation covers types,
 * URLs, ports, durations, allowed origins, and environment-specific hardening.
 */
export const envSchema = z
  .object({
    // App / HTTP
    NODE_ENV: z.enum(NODE_ENVIRONMENTS),
    APP_PORT: zPort.default(3000),
    APP_URL: z.url(),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
    CORS_ALLOWED_ORIGINS: z.string().min(1, "at least one origin is required"),
    CORS_CREDENTIALS: zBoolean.default(false),

    // Secret: Database
    DATABASE_URL: z.string().refine(isPostgresUrl, "must be a postgres:// or postgresql:// URL"),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_SSL: zBoolean.default(false),

    // Secret: JWT
    JWT_ACCESS_SECRET: z.string().min(32, "must be at least 32 characters"),
    JWT_REFRESH_SECRET: z.string().min(32, "must be at least 32 characters"),
    JWT_ACCESS_TTL: zDuration,
    JWT_REFRESH_TTL: zDuration,
    JWT_ISSUER: z.string().min(1).default("cadeau-crm"),

    // Secret: Encryption (AES-256 key, 32 bytes as 64 hex chars)
    ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "must be 64 hex characters (32 bytes)"),

    // Secret: PII blind-index key (HMAC-SHA256, 32 bytes as 64 hex chars).
    // Deliberately SEPARATE from ENCRYPTION_KEY so that compromising the search
    // index does not compromise the plaintext, and so the two rotate on their own
    // schedules. See docs/privacy-model.md §3.
    PII_HASH_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "must be 64 hex characters (32 bytes)"),

    // Secret: inbound carrier-webhook HMAC key (32 bytes as 64 hex chars,
    // EPIC-12 M12.4). Verifies `POST /v1/shipping/webhooks/{carrier}/{companyId}`
    // against the exact raw request bytes before the payload is trusted or
    // enqueued. Deliberately separate from ENCRYPTION_KEY/PII_HASH_KEY.
    SHIPPING_WEBHOOK_SIGNING_SECRET: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "must be 64 hex characters (32 bytes)"),

    // Platform Super-Admin bootstrap (optional, CSV of emails). The access seed
    // (EPIC-5) promotes matching profiles into `platform_admins`; privilege is a
    // separate DB-backed grant, never a tenant-token claim.
    SUPER_ADMIN_EMAILS: z.string().optional(),

    // Secret: OAuth (optional — reserved for future social/store login)
    OAUTH_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    OAUTH_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

    // Secret: Third-party APIs (optional — activated in their own epics)
    WHATSAPP_API_KEY: z.string().min(1).optional(),
    SHIPPING_BOSTA_API_KEY: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    // Allowed origins: each must be a valid http(s) URL (or the wildcard).
    const origins = splitList(value.CORS_ALLOWED_ORIGINS);
    if (origins.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["CORS_ALLOWED_ORIGINS"],
        message: "at least one origin is required",
      });
    }
    for (const origin of origins) {
      if (origin !== "*" && !isHttpUrl(origin)) {
        ctx.addIssue({
          code: "custom",
          path: ["CORS_ALLOWED_ORIGINS"],
          message: `"${origin}" is not a valid http(s) origin`,
        });
      }
    }

    // JWT secrets must not be identical.
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_REFRESH_SECRET"],
        message: "must differ from JWT_ACCESS_SECRET",
      });
    }

    // The PII blind-index key must not be the encryption key. Two separate keys
    // is the point: compromising the search index must not compromise the
    // plaintext, and the two rotate on their own schedules (docs/privacy-model.md).
    if (value.PII_HASH_KEY.toLowerCase() === value.ENCRYPTION_KEY.toLowerCase()) {
      ctx.addIssue({
        code: "custom",
        path: ["PII_HASH_KEY"],
        message: "must differ from ENCRYPTION_KEY",
      });
    }

    // The webhook signing secret must not reuse either other secret — a leaked
    // webhook secret (the one exposed to a third-party carrier's dashboard)
    // must not compromise encryption or the PII blind index.
    if (
      value.SHIPPING_WEBHOOK_SIGNING_SECRET.toLowerCase() === value.ENCRYPTION_KEY.toLowerCase() ||
      value.SHIPPING_WEBHOOK_SIGNING_SECRET.toLowerCase() === value.PII_HASH_KEY.toLowerCase()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["SHIPPING_WEBHOOK_SIGNING_SECRET"],
        message: "must differ from ENCRYPTION_KEY and PII_HASH_KEY",
      });
    }

    // OAuth client id/secret must be provided together.
    const hasOAuthId = value.OAUTH_GOOGLE_CLIENT_ID !== undefined;
    const hasOAuthSecret = value.OAUTH_GOOGLE_CLIENT_SECRET !== undefined;
    if (hasOAuthId !== hasOAuthSecret) {
      ctx.addIssue({
        code: "custom",
        path: ["OAUTH_GOOGLE_CLIENT_SECRET"],
        message: "OAUTH_GOOGLE_CLIENT_ID and OAUTH_GOOGLE_CLIENT_SECRET must be set together",
      });
    }

    // Production hardening.
    if (value.NODE_ENV === "production") {
      if (!value.APP_URL.startsWith("https://")) {
        ctx.addIssue({
          code: "custom",
          path: ["APP_URL"],
          message: "must use https in production",
        });
      }
      if (origins.includes("*")) {
        ctx.addIssue({
          code: "custom",
          path: ["CORS_ALLOWED_ORIGINS"],
          message: "wildcard '*' is forbidden in production",
        });
      }
      if (!value.DATABASE_SSL) {
        ctx.addIssue({
          code: "custom",
          path: ["DATABASE_SSL"],
          message: "must be true in production",
        });
      }
      const productionSecrets: ReadonlyArray<readonly [string, string]> = [
        ["JWT_ACCESS_SECRET", value.JWT_ACCESS_SECRET],
        ["JWT_REFRESH_SECRET", value.JWT_REFRESH_SECRET],
        ["ENCRYPTION_KEY", value.ENCRYPTION_KEY],
        ["PII_HASH_KEY", value.PII_HASH_KEY],
        ["SHIPPING_WEBHOOK_SIGNING_SECRET", value.SHIPPING_WEBHOOK_SIGNING_SECRET],
      ];
      for (const [name, secret] of productionSecrets) {
        if (INSECURE_PLACEHOLDER.test(secret)) {
          ctx.addIssue({
            code: "custom",
            path: [name],
            message: "must not use an example/placeholder value in production",
          });
        }
      }
    }
  });

export type ValidatedEnv = z.infer<typeof envSchema>;
