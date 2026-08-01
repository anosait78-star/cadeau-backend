import { splitList } from "./schema";
import type { ValidatedEnv } from "./schema";
import type { AppConfig, OAuthConfig, ThirdPartyConfig } from "./types";

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
    shipping: { webhookSigningSecret: env.SHIPPING_WEBHOOK_SIGNING_SECRET },
    notifications: {
      vapid: {
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
        subject: env.VAPID_SUBJECT,
      },
    },
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
    superAdminEmails: config.superAdminEmails,
  };
}
