# Auth API Contract

**Status:** ✅ Implemented — **EPIC-4** (M4.3 sessions, M4.4 2FA) · **Base path:**
`/v1/auth` · **Access:** public endpoints + self-service · **Feature key:** — (core)

Self-built JWT auth (access + refresh), 2FA, and session management. **No external
identity provider** (ADR / locked stack). Follows
[../api-conventions.md](../api-conventions.md).

## Resources

- `Session` — an access/refresh token pair + expiry.
- `TwoFactor` — TOTP enrolment + verification state.

## Planned endpoints

| Method | Path                            | Purpose                                                     | Permission             |
| ------ | ------------------------------- | ----------------------------------------------------------- | ---------------------- |
| POST   | `/v1/auth/register`             | Create an account (invite-gated).                           | public                 |
| POST   | `/v1/auth/login`                | Exchange credentials (+ `totpCode` when 2FA on) for tokens. | public                 |
| POST   | `/v1/auth/refresh`              | Rotate the access token from a refresh token.               | public (refresh token) |
| POST   | `/v1/auth/logout`               | Revoke the current session.                                 | authenticated          |
| GET    | `/v1/auth/sessions`             | List the caller's active sessions.                          | authenticated          |
| DELETE | `/v1/auth/sessions/{sessionId}` | Revoke a session.                                           | authenticated          |
| POST   | `/v1/auth/2fa/enroll`           | Begin TOTP enrolment (returns secret + otpauth URI, once).  | authenticated          |
| POST   | `/v1/auth/2fa/verify`           | Confirm a 6-digit code, enabling 2FA.                       | authenticated          |

## 2FA (TOTP) flow

Self-built TOTP (RFC 6238, base32 + HMAC-SHA1, `@cadeau/crypto`; no external OTP
library). `enroll` generates a secret, stores it **encrypted** (AES-256-GCM),
unconfirmed; `verify` checks a code (±1 step skew) and sets `totpEnabledAt`. Once
enabled, `login` requires `totpCode`: a missing code returns `401` with
`error.details.twoFactorRequired = true` (so the client can prompt); a wrong code
is an ordinary invalid-credentials `401`. Secrets/codes never appear in logs.

## List parameters

- `sessions` — sort (whitelist): `-createdAt,id` (default). No free-text search.

## Events emitted (ADR-004)

- `auth.logged_in`, `auth.logged_out`, `auth.token_refreshed`, `auth.2fa_enabled`.

## Notes

- **Credentials, tokens, and 2FA secrets never appear in logs or query strings.**
- Login/refresh are rate-limited (§11); repeated failures back off.
- Tokens carry the tenant + principal; `companyId` is never taken from the client.
