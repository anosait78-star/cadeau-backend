import { ConfigValidationError } from "./errors";
import { splitList } from "./schema";
import type { ValidatedEnv } from "./schema";
import type { AppConfig, OAuthConfig, S3Config, StorageConfig, ThirdPartyConfig } from "./types";

const REDACTED = "***REDACTED***";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** The five settings that together describe a usable bucket. */
const S3_REQUIRED = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_REGION",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

/**
 * The bucket configuration, or `undefined` when none of it is set.
 *
 * All-or-nothing on purpose. A half-configured bucket passes validation but
 * fails at the first upload — in production, long after boot — so a partial
 * group is rejected here instead, naming the settings that are missing.
 */
function buildS3Config(env: ValidatedEnv): { s3: S3Config } | undefined {
  const missing = S3_REQUIRED.filter((key) => env[key] === undefined);
  if (missing.length === S3_REQUIRED.length) return undefined;
  if (missing.length > 0) {
    throw new ConfigValidationError([
      {
        path: missing.join(", "),
        message:
          "object storage is partially configured: set all of " +
          `${S3_REQUIRED.join(", ")}, or none of them to fall back to in-memory storage`,
      },
    ]);
  }

  return {
    s3: {
      endpoint: env.S3_ENDPOINT as string,
      bucket: env.S3_BUCKET as string,
      region: env.S3_REGION as string,
      accessKeyId: env.S3_ACCESS_KEY_ID as string,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY as string,
      ...(env.S3_SESSION_TOKEN === undefined ? {} : { sessionToken: env.S3_SESSION_TOKEN }),
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    },
  };
}

/**
 * Transform the flat validated environment into the structured, deeply-frozen
 * application configuration grouped by secret classification.
 */
export function buildConfig(env: ValidatedEnv): AppConfig {
  const oauth: OAuthConfig =
    env.OAUTH_GOOGLE_CLIENT_ID !== undefined && env.OAUTH_GOOGLE_CLIENT_SECRET !== undefined
      ? {
          google: {
            clientId: env.OAUTH_GOOGLE_CLIENT_ID,
            clientSecret: env.OAUTH_GOOGLE_CLIENT_SECRET,
          },
        }
      : {};

  const storage: StorageConfig = { ...(buildS3Config(env) ?? {}) };

  const thirdParty: { -readonly [K in keyof ThirdPartyConfig]: ThirdPartyConfig[K] } = {};
  if (env.WHATSAPP_API_KEY !== undefined) thirdParty.whatsappApiKey = env.WHATSAPP_API_KEY;
  if (env.SHIPPING_BOSTA_API_KEY !== undefined)
    thirdParty.shippingBostaApiKey = env.SHIPPING_BOSTA_API_KEY;

  const config: AppConfig = {
    env: env.NODE_ENV,
    isDevelopment: env.NODE_ENV === "development",
    isTest: env.NODE_ENV === "test",
    isStaging: env.NODE_ENV === "staging",
    isProduction: env.NODE_ENV === "production",
    http: {
      port: env.APP_PORT,
      url: env.APP_URL,
      requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
      cors: {
        allowedOrigins: splitList(env.CORS_ALLOWED_ORIGINS),
        credentials: env.CORS_CREDENTIALS,
      },
    },
    logging: { level: env.LOG_LEVEL },
    database: {
      url: env.DATABASE_URL,
      poolMax: env.DATABASE_POOL_MAX,
      ssl: env.DATABASE_SSL,
    },
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessTtl: env.JWT_ACCESS_TTL,
      refreshTtl: env.JWT_REFRESH_TTL,
      issuer: env.JWT_ISSUER,
    },
    encryption: { key: env.ENCRYPTION_KEY, blindIndexKey: env.PII_HASH_KEY },
    oauth,
    thirdParty,
    shipping: {
      webhookSigningSecret: env.SHIPPING_WEBHOOK_SIGNING_SECRET,
      // https, not http: Bosta 308-redirects http→https, and a cross-scheme
      // redirect makes `fetch` drop the Authorization header (by spec) —
      // hitting http here silently turns every call into an unauthenticated
      // one instead of erroring loudly.
      bostaBaseUrl: env.BOSTA_API_BASE_URL ?? "https://app.bosta.co/api/v2/",
      // v2 has no working cancel endpoint — verified live. v1's
      // `DELETE /deliveries/{id}` is the one that actually works.
      bostaApiV1BaseUrl: env.BOSTA_API_V1_BASE_URL ?? "https://app.bosta.co/api/v1/",
    },
    notifications: {
      vapid: {
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
        subject: env.VAPID_SUBJECT,
      },
    },
    storage,
    superAdminEmails: env.SUPER_ADMIN_EMAILS !== undefined ? splitList(env.SUPER_ADMIN_EMAILS) : [],
  };

  return deepFreeze(config);
}

/**
 * A copy of the configuration with every secret masked — safe to log at boot.
 */
export function redactConfig(config: AppConfig): Record<string, unknown> {
  return {
    env: config.env,
    http: {
      port: config.http.port,
      url: config.http.url,
      requestTimeoutMs: config.http.requestTimeoutMs,
      cors: config.http.cors,
    },
    logging: config.logging,
    database: {
      url: config.database.url.replace(/:\/\/([^:@/]+):([^@/]+)@/, "://$1:" + REDACTED + "@"),
      poolMax: config.database.poolMax,
      ssl: config.database.ssl,
    },
    jwt: {
      accessSecret: REDACTED,
      refreshSecret: REDACTED,
      accessTtl: config.jwt.accessTtl,
      refreshTtl: config.jwt.refreshTtl,
      issuer: config.jwt.issuer,
    },
    encryption: { key: REDACTED, blindIndexKey: REDACTED },
    shipping: { webhookSigningSecret: REDACTED },
    notifications: {
      vapid: {
        publicKey: config.notifications.vapid.publicKey,
        privateKey: REDACTED,
        subject: config.notifications.vapid.subject,
      },
    },
    oauth: config.oauth.google ? { google: { clientId: REDACTED, clientSecret: REDACTED } } : {},
    thirdParty: {
      whatsappApiKey: config.thirdParty.whatsappApiKey ? REDACTED : undefined,
      shippingBostaApiKey: config.thirdParty.shippingBostaApiKey ? REDACTED : undefined,
    },
    storage:
      config.storage.s3 === undefined
        ? { s3: undefined }
        : {
            s3: {
              endpoint: config.storage.s3.endpoint,
              bucket: config.storage.s3.bucket,
              region: config.storage.s3.region,
              accessKeyId: REDACTED,
              secretAccessKey: REDACTED,
              sessionToken: config.storage.s3.sessionToken ? REDACTED : undefined,
              forcePathStyle: config.storage.s3.forcePathStyle,
            },
          },
    superAdminEmails: config.superAdminEmails,
  };
}
