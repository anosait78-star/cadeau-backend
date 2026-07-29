# Security Policy

Security is a first-class architectural constraint for Cadeau CRM (ADR-001): it takes
precedence over development speed.

## Dependency policy

- **Stable only** — no Alpha/Beta/RC in production (enforced by `scripts/check-stable-only.mjs`).
- **No Critical/High** — any component with an unresolved Critical/High advisory is excluded,
  regardless of popularity (enforced by `pnpm audit --audit-level high` in CI).
- Every dependency is vetted (CVEs · GitHub Security Advisories · npm Advisories · OWASP) before
  adoption; exact versions are pinned via lockfile.
- Notable dependency-security decisions are recorded in
  [`docs/security/dependency-decisions.md`](docs/security/dependency-decisions.md).

## CI security gates (merge-blocking)

| Gate                             | Tool                                                                  |
| -------------------------------- | --------------------------------------------------------------------- |
| Dependency audit (High/Critical) | `pnpm audit`                                                          |
| Stable-only enforcement          | `scripts/check-stable-only.mjs`                                       |
| SAST                             | Semgrep (`p/default`, `p/typescript`, `p/owasp-top-ten`, `p/secrets`) |
| Secret scanning                  | Gitleaks                                                              |
| SCA / update monitoring          | Dependabot                                                            |

## Supply-chain integrity

- All GitHub Actions are pinned by **commit SHA** (not moving tags); container images are pinned by
  **`@sha256` digest**. Dependabot keeps these pins updated via reviewed PRs.

## Secrets

- Secrets live in environment variables / a secrets manager **only** — never in the repository.
- Integration keys are server-side only and never reach the browser.

## Reporting a vulnerability

Report suspected vulnerabilities privately to the maintainers. Do not open a public issue for
security reports.
