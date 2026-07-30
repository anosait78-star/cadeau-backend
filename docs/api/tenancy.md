# Tenancy API Contract

**Status:** 🟨 Partial — **EPIC-4 · M4.4** (me, companies, switch, invitations);
member/company management gated by permissions lands in **EPIC-5** · **Base paths:**
`/v1/me`, `/v1/companies`, `/v1/invitations` · **Feature key:** — (core) ·
**Access:** authenticated

Companies, membership, and the caller's own profile. A user may belong to
multiple companies; the active tenant comes from the token, never the payload
(ADR-003). Follows [../api-conventions.md](../api-conventions.md).

## Resources

- `Company` — a tenant.
- `CompanyMember` — a user's membership + role in a company.
- `Profile` — the caller's user profile (PII encrypted at rest).
- `Invitation` — a revocable invite to join a company.

## Planned endpoints

| Method | Path                                                   | Purpose                                           | Permission / status                          |
| ------ | ------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------- |
| GET    | `/v1/me`                                               | The caller's profile + companies.                 | authenticated ✅                             |
| GET    | `/v1/companies`                                        | Companies the caller belongs to.                  | authenticated ✅                             |
| POST   | `/v1/companies`                                        | Create a company (become owner) + switch into it. | authenticated ✅                             |
| POST   | `/v1/companies/{companyId}/switch`                     | Switch the active tenant; re-issues tokens.       | authenticated (member) ✅                    |
| POST   | `/v1/companies/{companyId}/invitations`                | Invite a member (returns a one-time code).        | active-member ✅ (→ `members.manage` EPIC-5) |
| DELETE | `/v1/companies/{companyId}/invitations/{invitationId}` | Revoke a pending invite.                          | active-member ✅ (→ `members.manage` EPIC-5) |
| POST   | `/v1/invitations/accept`                               | Accept an invite by code (join a company).        | authenticated ✅                             |
| PATCH  | `/v1/me`                                               | Update own profile.                               | authenticated ⬜ EPIC-5                      |
| GET    | `/v1/companies/{companyId}`                            | Company detail.                                   | `company.read` ⬜ EPIC-5                     |
| PATCH  | `/v1/companies/{companyId}`                            | Update company.                                   | `company.manage` ⬜ EPIC-5                   |
| GET    | `/v1/companies/{companyId}/members`                    | List members.                                     | `members.read` ⬜ EPIC-5                     |
| DELETE | `/v1/companies/{companyId}/members/{memberId}`         | Remove a member.                                  | `members.manage` ⬜ EPIC-5                   |

## Notes on the M4.4 endpoints

- **Switch / create re-issue tokens.** Creating or switching a company rebinds the
  current session to that tenant, rotates its refresh token, and returns a new
  token pair whose access token carries the tenant (`cid`).
- **`companyId` is authority-checked, not trusted.** Tenant-scoped operations
  (invite create/revoke) require the path `companyId` to equal the active tenant in
  the token AND an active membership; otherwise `403` (ADR-003).
- **Invite codes** are high-entropy, returned once, stored only as a SHA-256 hash;
  acceptance is email-matched, single-use, and idempotent (re-accept ⇒
  `alreadyMember: true`). Invalid/expired/revoked codes all return an
  indistinguishable `404` (no enumeration).

## List parameters

- `members` — filter: `role`, `status`; sort (whitelist): `-createdAt,id` (default); search `q` over name/email. _(EPIC-5.)_

## Events emitted (ADR-004)

- `company.created`, `member.invited`, `member.joined`, `member.removed`.

## Notes

- Switching the active company re-issues a token scoped to that tenant.
- Personal data (PII) is encrypted; exports are restricted and audited.
