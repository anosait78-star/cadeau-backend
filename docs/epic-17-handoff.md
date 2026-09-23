# EPIC-17 · Vendor Messaging — handoff

Continuation notes for the remaining milestones. Branch: `feat/epic-17-messaging`.

**Read this first if you are picking the work up in a new session.** It records
what already exists, what is left, and the decisions that later milestones must
not quietly undo.

---

## 1. What the feature is

One conversation per vendor, between that vendor and the company's staff.
Messages carry text, images, and references to specific orders (`@`), so a note
about an order says which order it is about.

A "vendor" is a `CompanyMember` whose `warehouseId` is set — the membership is
confined to exactly one warehouse (Vendor Accounts, Phase 1). That column, not
`role === "vendor"`, is the source of truth everywhere in this module.

---

## 2. What is already done

| Milestone | Commit    | What landed                                                                             |
| --------- | --------- | --------------------------------------------------------------------------------------- |
| M17.1     | `e796280` | Five tables, RLS policies, access-catalog entries, `message.received` notification type |
| M17.2     | `6766f45` | Domain/service/repository/controller for text messages                                  |
| M17.3     | `ced83e4` | `@cadeau/storage`, image upload + re-encode, orphan sweeper                             |
| M17.4     | `6d282c6` | `@` order mentions: picker + server-side validation                                     |
| M17.5     | `4b181e5` | `message.received` notification dispatch                                                |

### Files

```
packages/storage/                         # object storage (self-built SigV4, S3 + in-memory)
packages/database/prisma/migrations/20260923000000_messaging/
apps/api/src/modules/messaging/
  domain/        message.entity.ts, participation.ts, image-rules.ts,
                 mention-rules.ts, *.port.ts, messaging.errors.ts
  application/   messaging.service.ts               # publishes `message.created`
  infrastructure/messaging.repository.ts, sharp-image-processor.ts,
                 file-storage.provider.ts, orphan-attachment-sweeper.ts,
                 audit-log.adapter.ts
  presentation/  messaging.controller.ts, dto/messaging.dto.ts
apps/api/src/modules/notifications/         # M17.5 additions, not a new module
  domain/        messaging-facts.port.ts
  infrastructure/messaging-facts.adapter.ts # reads message_threads/company_members
                                             # directly, own Prisma client — the same
                                             # cross-module idiom order-facts.adapter.ts
                                             # uses for `orders`
  application/notification-dispatch.service.ts  # +onMessageCreated
```

M17.5 in one paragraph: `MessagingService.sendMessage` publishes
`message.created` (`shared/events/event-catalog.ts`) with `threadId`,
`warehouseId`, `senderKind` and a `preview` — the same capped string already
stored on `MessageThread.lastMessagePreview`, never the raw body.
`NotificationDispatchService.onMessageCreated` resolves the audience through
the new `MessagingFactsPort` (every `messaging.manage` holder when a vendor
wrote, the thread's vendor when staff wrote) and raises `message.received`.
The stored `title`/`body` — what `apps/web/public/sw.js` puts on the OS push
banner, outside any auth check — stay generic with no message content; the
`preview` only ever travels inside the push payload's `data`, read by the
same authenticated recipient who could already see it via `GET /threads`.

### Endpoints (all under `/v1/messaging`)

| Route                                    | Permission                                                        |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `GET /threads`                           | `messaging.read` — staff see all, a vendor sees only their own    |
| `GET /threads/me`                        | `messaging.read` — the vendor's own thread, created on first open |
| `GET /vendors`                           | `messaging.manage` — staff-only picker of vendors                 |
| `POST /threads`                          | `messaging.manage` — get-or-create by `warehouseId`               |
| `GET /threads/:id/messages`              | `messaging.read`                                                  |
| `POST /threads/:id/messages`             | `messaging.send` — `{ body?, attachmentIds[], orderIds[] }`       |
| `POST /threads/:id/read`                 | `messaging.read`                                                  |
| `GET /threads/:id/mentionable-orders?q=` | `messaging.read`                                                  |
| `POST /attachments`                      | `messaging.send` — multipart, field name `file`                   |

---

## 3. Decisions later milestones must preserve

These are load-bearing. Changing any of them is a security or privacy change,
not a refactor.

1. **Vendor isolation is enforced twice**, independently: the
   `message_threads_tenant` RLS policy (via `app.current_member_warehouse_id()`)
   _and_ `canAccessThread` in `participation.ts`. Keep both. The service layer
   exists so a caller gets an honest 404 instead of a silently empty list.

2. **A thread the caller may not see is reported as 404, never 403.** A 403
   confirms the conversation exists, and enough probes enumerate the company's
   vendors. Same rule for a rejected order id: the id is never named.

3. **Mention scope applies to staff as well as vendors.** Only orders whose
   `OrderVendorGroup` matches the thread's warehouse. Staff are included
   because the mention renders into the vendor's conversation.

4. **Customer-name search is staff-only** (`allowCustomerSearch`). A vendor
   reaches these orders through their own group — their items and the order
   number, not who placed it.

5. **The mention card carries number + status only.** No order total (it sums
   every vendor's items) and no customer.

6. **Audit rows are PII-free**: ids, counts and lengths. Never a message body.

7. **Uploads: object first, row second. Sweep: object first, row second.** Both
   orderings are deliberate; see the comments in `messaging.service.ts` and
   `orphan-attachment-sweeper.ts`.

8. **Signed URLs are minted per response**, never stored (15-minute TTL).

---

## 4. Remaining milestones

M17.5 is done (see §2 for what landed). What is left:

### M17.6 — Web UI (~2 days)

New feature folder `apps/web/src/features/messaging`, plus a tab inside
`apps/web/src/features/vendor` for the vendor side.

- **Staff:** thread list (vendor name, last message, unread badge) → thread view.
- **Vendor:** one tab that opens straight onto `GET /threads/me`.
- **Message bubble:** text, image grid with a lightbox, and an order card per
  `orderRefs` entry (number + status, clickable through to the order).
- **`@` picker:** typing `@` opens a popover, 250 ms debounce against
  `mentionable-orders`, selection inserts a chip. **Chips are stored separately
  from the text** and sent as `orderIds` — never parsed back out of the body, or
  a user could forge a mention by typing one.
- **Refresh:** poll every 15 s while the view is open, pause on
  `visibilitychange`, and refetch when a `message.received` notification
  arrives. No SSE — there is no realtime infrastructure in this codebase and
  adding it is its own epic.
- RTL and mobile-first (ADR-002); reuse the existing UI components.
- Remember to add Arabic + English strings to `apps/web/src/i18n/dictionaries.ts`
  (both dictionaries — there is a parity test).

### M17.7 — Quality gate (~1 day)

- `docs/epic-17-design.md` and `docs/messaging-domain.md`.
- Update `docs/permission-matrix.md` with `messaging.read/manage/send`.
- Update `docs/api/` with the new endpoints.
- Integration tests against a real database, which is the gap listed below.
- `docs/epic-17-quality-gate.md` following the EPIC-15/16 format.

---

## 5. Known gaps and environment notes

**Nothing here has run against a real database or a real bucket.** Docker and
Postgres were unavailable in the session that wrote M17.1–M17.4, so:

- The messaging migration has **never been applied**. Run
  `pnpm --filter @cadeau/database db:migrate:deploy` and verify before trusting
  any of it.
- The RLS policies are unverified. The highest-value test to write first:
  _vendor A cannot read vendor B's thread, and cannot mention an order that is
  not theirs_ — at the database level, not just through the service.
- The repository queries (especially the `vendorGroups: { some: … }` filter and
  the nulls-last keyset cursor) are type-checked and mocked, not executed.
- `S3FileStorage` is verified against AWS's published signature vectors, but has
  never talked to a live bucket.

**Pre-existing red gates** (confirmed failing on a clean tree, unrelated to this
work — a background task was filed for them):

- `apps/api/src/modules/products/presentation/products.controller.test.ts:62`
  — TS2741, the `ServiceMock` is missing `listMyVendorProducts`. This makes the
  whole API type-check fail, so filter it out when checking your own work.
- `apps/api/src/modules/shipping/infrastructure/shipping.repository.test.ts`
  — 10 of 29 tests fail.

**Shell quirks in this environment** (they cost real time):

- `node_modules/.bin/*` shims fail under the Bash tool. Invoke tools through
  node: `node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit`,
  `node node_modules/eslint/bin/eslint.js <paths>`. Package-local shims
  (`apps/api/node_modules/.bin/vitest`) do work.
- **Check exit codes properly.** `cmd | tail` then `echo $?` reports `tail`'s
  status, not the tool's — this silently hid a broken lint run for a while.
- Vitest needs `--no-file-parallelism --pool=threads` here; the default pool
  times out starting workers.
- Heredocs (`<< 'EOF'`) break in this shell. Use the Write tool for file
  content and `git commit -F <file>` for commit messages.
- `pnpm` is not on PATH: `export PATH="$(dirname "$(which node)"):$PATH"` then
  `corepack pnpm …`. The same export is needed before `git commit`, or the
  husky/lint-staged hook fails.

---

## 6. Suggested first move in the new session

```bash
git checkout feat/epic-17-messaging
```

Then start the database and apply the migration — verifying M17.1–M17.4 against
a real Postgres is worth more than starting M17.5 on top of unverified
foundations.
