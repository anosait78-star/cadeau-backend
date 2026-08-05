# @cadeau/crypto

Self-built security primitives for Cadeau CRM — **`node:crypto` only, zero runtime
dependencies**. The locked stack mandates a fully in-house auth system with no
external identity/crypto service (ADR-001).

- **Password hashing** — `hashPassword` / `verifyPassword`: scrypt with a random
  per-password salt and a constant-time compare. Hashes are self-describing
  (`scrypt$N$r$p$salt$hash`), so cost parameters can be raised later without
  breaking existing hashes.
- **PII encryption** — `encrypt` / `decrypt`: AES-256-GCM (authenticated). Encrypts
  phones/addresses/etc. before storage; tampering fails the auth tag on decrypt.
  Takes the 32-byte key from `@cadeau/config` `encryption.key` (crypto stays
  config-free).
- **JWT** — `signJwt` / `verifyJwt`: HS256 only. The `alg` header is verified and
  signatures are compared in constant time, so `alg:"none"` and algorithm-confusion
  attacks are rejected. Checks `exp` and (optionally) `iss`.

## Usage

```ts
import { hashPassword, verifyPassword, encrypt, decrypt, signJwt, verifyJwt } from "@cadeau/crypto";

const stored = await hashPassword(plain); // at registration
const ok = await verifyPassword(attempt, stored); // at login

const token = signJwt({ sub: userId }, cfg.jwt.accessSecret, {
  expiresInSeconds: 900,
  issuer: cfg.jwt.issuer,
});
const claims = verifyJwt(token, cfg.jwt.accessSecret, { issuer: cfg.jwt.issuer });

const cipher = encrypt(phone, cfg.encryption.key); // AES-256-GCM
```

## Scripts

```bash
pnpm --filter @cadeau/crypto type-check
pnpm --filter @cadeau/crypto test    # Vitest + coverage
```
