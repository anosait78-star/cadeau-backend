# Tenancy API Contract

**Status:** ⬜ Draft — planned in **EPIC-4** · **Base paths:** `/v1/companies`, `/v1/me` ·
**Feature key:** — (core) · **Access:** authenticated

Companies, membership, and the caller's own profile. A user may belong to
multiple companies; the active tenant comes from the token, never the payload
(ADR-003). Draft — follows [../api-conventions.md](../api-conventions.md).

## Resources

- `Company` — a tenant.
- `CompanyMember` — a user's membership + role in a company.
- `Profile` — the caller's user profile (PII encrypted at rest).
- `Invitation` — a revocable invite to join a company.

## Planned endpoints

| Method | Path                                                   | Purpose                           | Permission       |
| ------ | ------------------------------------------------------ | --------------------------------- | ---------------- |
| GET    | `/v1/me`                                               | The caller's profile + companies. | authenticated    |
| PATCH  | `/v1/me`                                               | Update own profile.               | authenticated    |
| GET    | `/v1/companies`                                        | Companies the caller belongs to.  | authenticated    |
| POST   | `/v1/companies`                                        | Create a company.                 | authenticated    |
| GET    | `/v1/companies/{companyId}`                            | Company detail.                   | `company.read`   |
| PATCH  | `/v1/companies/{companyId}`                            | Update company.                   | `company.manage` |
| GET    | `/v1/companies/{companyId}/members`                    | List members.                     | `members.read`   |
| POST   | `/v1/companies/{companyId}/invitations`                | Invite a member. Idempotency-Key. | `members.manage` |
| DELETE | `/v1/companies/{companyId}/invitations/{invitationId}` | Revoke an invite.                 | `members.manage` |
| DELETE | `/v1/companies/{companyId}/members/{memberId}`         | Remove a member.                  | `members.manage` |

## List parameters

- `members` — filter: `role`, `status`; sort (whitelist): `-createdAt,id` (default); search `q` over name/email.

## Events emitted (ADR-004)

- `company.created`, `member.invited`, `member.joined`, `member.removed`.

## Notes

- Switching the active company re-issues a token scoped to that tenant.
- Personal data (PII) is encrypted; exports are restricted and audited.
