import type { NodeEnv } from "./environment";

export interface HttpCorsConfig {
  readonly allowedOrigins: readonly string[];
  readonly credentials: boolean;
}

export interface HttpConfig {
  readonly port: number;
  readonly url: string;
  readonly requestTimeoutMs: number;
  readonly cors: HttpCorsConfig;
}

export interface LoggingConfig {
  readonly level: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
}

export interface DatabaseConfig {
  readonly url: string;
  readonly poolMax: number;
  readonly ssl: boolean;
}

export interface JwtConfig {
  readonly accessSecret: string;
  readonly refreshSecret: string;
  readonly accessTtl: string;
  readonly refreshTtl: string;
  readonly issuer: string;
}

export interface EncryptionConfig {
  /** 32-byte AES key encoded as 64 hex characters. */
  readonly key: string;
  /**
   * 32-byte HMAC key (64 hex characters) for PII blind indexes — the searchable,
   * unique-indexable companion to an encrypted column (EPIC-10, `customers.phone_hash`).
   * Separate from {@link key} by design: see `docs/privacy-model.md` §3.
   */
  readonly blindIndexKey: string;
}

export interface OAuthProviderConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface OAuthConfig {
  readonly google?: OAuthProviderConfig;
}

export interface ThirdPartyConfig {
  readonly whatsappApiKey?: string;
  readonly shippingBostaApiKey?: string;
}

export interface ShippingConfig {
  /**
   * 32-byte HMAC key (64 hex characters) verifying inbound carrier webhooks
   * (EPIC-12 M12.4) against the raw request body. Separate from
   * {@link EncryptionConfig.key} / {@link EncryptionConfig.blindIndexKey}.
   */
  readonly webhookSigningSecret: string;
}

/**
 * The fully validated, structured, read-only application configuration.
 * This is the single source of truth consumed everywhere — no module reads
 * `process.env` directly.
 */
export interface AppConfig {
  readonly env: NodeEnv;
  readonly isDevelopment: boolean;
  readonly isTest: boolean;
  readonly isStaging: boolean;
  readonly isProduction: boolean;
  readonly http: HttpConfig;
  readonly logging: LoggingConfig;
  readonly database: DatabaseConfig;
  readonly jwt: JwtConfig;
  readonly encryption: EncryptionConfig;
  readonly oauth: OAuthConfig;
  readonly thirdParty: ThirdPartyConfig;
  readonly shipping: ShippingConfig;
  /**
   * Emails that bootstrap the platform Super-Admin grant (EPIC-5). The access
   * seed promotes matching profiles into `platform_admins`. Empty when unset.
   */
  readonly superAdminEmails: readonly string[];
}
