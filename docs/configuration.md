# Configuration Reference

All runtime configuration for Cadeau CRM comes from environment variables, validated once at
boot by the `@cadeau/config` package. Invalid or missing required variables **prevent the
application from starting** with an actionable error listing every problem.

## Rules

- **Single source of truth:** application code reads configuration only through `@cadeau/config`.
  Direct `process.env` access is forbidden by lint rule outside that package.
- **Environment separation:** `NODE_ENV` must be one of `development | test | staging | production`
  and must be set explicitly. Only the dotenv file matching `NODE_ENV` is loaded
  (`.env.<env>`), so production configuration is never used during development.
- **Precedence:** platform-injected `process.env` wins over dotenv files.
- **Secrets** live in a secrets manager / platform env — never committed. Templates end in
  `.example`.

## Variables

Legend — **Req**: required (boot fails if missing) · **Opt**: optional. Class: secret classification.

| Variable                          | Type               | Req/Opt | Default      | Class           | Description                                                                                                                |
| --------------------------------- | ------------------ | ------- | ------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                        | enum               | Req     | —            | App             | Runtime environment: `development`/`test`/`staging`/`production`.                                                          |
| `APP_PORT`                        | port (1-65535)     | Opt     | `3000`       | App             | HTTP port the BFF listens on.                                                                                              |
| `APP_URL`                         | url                | Req     | —            | App             | Public base URL. Must be `https://` in production.                                                                         |
| `LOG_LEVEL`                       | enum               | Opt     | `info`       | App             | `fatal`/`error`/`warn`/`info`/`debug`/`trace`.                                                                             |
| `REQUEST_TIMEOUT_MS`              | int (1000-120000)  | Opt     | `30000`      | App             | Per-request timeout in ms.                                                                                                 |
| `CORS_ALLOWED_ORIGINS`            | csv of urls        | Req     | —            | App             | Allowed origins. `*` is forbidden in production.                                                                           |
| `CORS_CREDENTIALS`                | bool               | Opt     | `false`      | App             | Whether CORS allows credentials.                                                                                           |
| `DATABASE_URL`                    | postgres url       | Req     | —            | **Database**    | `postgres://`/`postgresql://` connection string.                                                                           |
| `DATABASE_POOL_MAX`               | int (1-100)        | Opt     | `10`         | Database        | Max DB pool connections.                                                                                                   |
| `DATABASE_SSL`                    | bool               | Opt     | `false`      | Database        | Require SSL. Must be `true` in production.                                                                                 |
| `JWT_ACCESS_SECRET`               | string (≥32)       | Req     | —            | **JWT**         | Access-token signing secret.                                                                                               |
| `JWT_REFRESH_SECRET`              | string (≥32)       | Req     | —            | JWT             | Refresh-token secret; must differ from access.                                                                             |
| `JWT_ACCESS_TTL`                  | duration           | Req     | —            | JWT             | Access-token lifetime (e.g. `15m`).                                                                                        |
| `JWT_REFRESH_TTL`                 | duration           | Req     | —            | JWT             | Refresh-token lifetime (e.g. `7d`).                                                                                        |
| `JWT_ISSUER`                      | string             | Opt     | `cadeau-crm` | JWT             | Token `iss` claim.                                                                                                         |
| `ENCRYPTION_KEY`                  | 64 hex chars       | Req     | —            | **Encryption**  | 32-byte AES-256 key for PII. `openssl rand -hex 32`.                                                                       |
| `PII_HASH_KEY`                    | 64 hex chars       | Req     | —            | Encryption      | 32-byte HMAC key for PII blind indexes. Must **differ** from `ENCRYPTION_KEY`. See [privacy-model.md](privacy-model.md).   |
| `SHIPPING_WEBHOOK_SIGNING_SECRET` | 64 hex chars       | Req     | —            | Encryption      | 32-byte HMAC key verifying inbound carrier webhooks (EPIC-12 M12.4). Must **differ** from `ENCRYPTION_KEY`/`PII_HASH_KEY`. |
| `VAPID_PUBLIC_KEY`                | base64url (87)     | Req     | —            | **Web Push**    | Self-generated P-256 public key (EPIC-15 M15.1), sent to browsers at subscribe time. `npx web-push generate-vapid-keys`.   |
| `VAPID_PRIVATE_KEY`               | base64url (43)     | Req     | —            | Web Push        | Self-generated P-256 private key; signs the VAPID JWT on every Web Push send.                                              |
| `VAPID_SUBJECT`                   | `mailto:`/`https:` | Req     | —            | Web Push        | Operator contact required by RFC 8292.                                                                                     |
| `OAUTH_GOOGLE_CLIENT_ID`          | string             | Opt     | —            | **OAuth**       | Reserved (future). Set together with the secret.                                                                           |
| `OAUTH_GOOGLE_CLIENT_SECRET`      | string             | Opt     | —            | OAuth           | Reserved (future). Set together with the id.                                                                               |
| `WHATSAPP_API_KEY`                | string             | Opt     | —            | **Third-party** | Reserved for the WhatsApp integration epic.                                                                                |
| `SHIPPING_BOSTA_API_KEY`          | string             | Opt     | —            | Third-party     | Reserved for the shipping integration epic.                                                                                |

## Secret management

| Class       | Variables                                                           | Where stored / how managed                                                                                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database    | `DATABASE_URL`                                                      | Secrets manager (prod/staging); local dev DB via Docker (M1.4).                                                                                                                                                                                                                                                       |
| JWT         | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`                           | Secrets manager; rotated periodically (least privilege).                                                                                                                                                                                                                                                              |
| Encryption  | `ENCRYPTION_KEY`, `PII_HASH_KEY`, `SHIPPING_WEBHOOK_SIGNING_SECRET` | Secrets manager; separate keys, separate schedules. Rotating `ENCRYPTION_KEY` requires a re-encryption plan; rotating `PII_HASH_KEY` requires a re-hash migration ([privacy-model.md](privacy-model.md) §3); rotating `SHIPPING_WEBHOOK_SIGNING_SECRET` requires re-registering the webhook secret with each carrier. |
| Web Push    | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`                             | Secrets manager; self-generated (not a third-party credential — RFC 8292). Rotating invalidates every existing browser subscription (they re-subscribe against the new public key).                                                                                                                                   |
| OAuth       | `OAUTH_GOOGLE_*`                                                    | Provider console → secrets manager (when the feature ships).                                                                                                                                                                                                                                                          |
| Third-party | `WHATSAPP_API_KEY`, `SHIPPING_BOSTA_API_KEY`                        | Provider dashboards → secrets manager (per integration epic).                                                                                                                                                                                                                                                         |

## Runtime validation summary

Validated before the app runs: environment type, URLs (`APP_URL`, origins), ports (`APP_PORT`),
JWT durations (`JWT_*_TTL`), timeouts (`REQUEST_TIMEOUT_MS`), CORS origins/credentials, database
URL shape, secret lengths/format, and — in production — https, non-wildcard CORS, database SSL,
and absence of placeholder secrets.
