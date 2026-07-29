# Auth API Contract

**Status:** ⬜ Draft — planned in **EPIC-4** · **Base path:** `/v1/auth` ·
**Access:** public endpoints + self-service · **Feature key:** — (core)

Self-built JWT auth (access + refresh), 2FA, and session management. **No external
identity provider** (ADR / locked stack). Draft — follows
[../api-conventions.md](../api-conventions.md); shapes finalized in EPIC-4.

## Resources

- `Session` — an access/refresh token pair + expiry.
- `TwoFactor` — TOTP enrolment + verification state.

## Planned endpoints

| Method | Path                            | Purpose                                                    | Permission             |
| ------ | ------------------------------- | ---------------------------------------------------------- | ---------------------- |
| POST   | `/v1/auth/register`             | Create an account (invite-gated).                          | public                 |
| POST   | `/v1/auth/login`                | Exchange credentials for tokens. Idempotency-Key optional. | public                 |
| POST   | `/v1/auth/refresh`              | Rotate the access token from a refresh token.              | public (refresh token) |
| POST   | `/v1/auth/logout`               | Revoke the current session.                                | authenticated          |
| GET    | `/v1/auth/sessions`             | List the caller's active sessions.                         | authenticated          |
| DELETE | `/v1/auth/sessions/{sessionId}` | Revoke a session.                                          | authenticated          |
| POST   | `/v1/auth/2fa/enroll`           | Begin TOTP enrolment.                                      | authenticated          |
| POST   | `/v1/auth/2fa/verify`           | Confirm a 2FA code.                                        | authenticated          |

## List parameters

- `sessions` — sort (whitelist): `-createdAt,id` (default). No free-text search.

## Events emitted (ADR-004)

- `auth.logged_in`, `auth.logged_out`, `auth.token_refreshed`, `auth.2fa_enabled`.

## Notes

- **Credentials, tokens, and 2FA secrets never appear in logs or query strings.**
- Login/refresh are rate-limited (§11); repeated failures back off.
- Tokens carry the tenant + principal; `companyId` is never taken from the client.
