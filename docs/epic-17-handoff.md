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
| M17.6     | _pending_ | Web UI: staff thread list/panel, vendor tab, composer, `@` picker, lightbox             |

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

### Web files (M17.6)

```
apps/web/src/features/messaging/
  messaging-api.ts             # typed client for every /v1/messaging route
  use-message-thread.ts        # one open thread: ordering, loadOlder, send, 15s poll
  use-thread-list.ts           # staff's GET /threads, keyset "load more"
  use-mentionable-orders.ts    # 250ms-debounced @ picker search
  thread-view.tsx              # message list + composer, shared by both sides
  thread-view-frame.tsx        # bounds ThreadView's scroll region on both shells
  thread-list-row.tsx          # staff list row (avatar, preview, unread dot, time)
  message-bubble.tsx           # one message: text, image grid, order-ref cards
  message-composer.tsx         # textarea, @ popover, attach, send
  image-lightbox.tsx           # full-screen image viewer
  order-ref-status-tones.ts    # status → BadgeTone for the mention card
apps/web/src/pages/messaging/messaging-page.tsx      # staff: list + SideSheet panel
apps/web/src/pages/vendor/vendor-messages-page.tsx   # vendor: GET /threads/me, full page
```

Also touched: `router.tsx`/`config/navigation.ts` (routes + nav items),
`lib/api-client.ts` (+`apiFetchMultipart`, the only upload in this app),
`i18n/dictionaries.ts` (+`messaging.*`/`vendor.messages.*`/`nav.messages`
keys, both languages), `features/notifications/notifications-api.ts` +
`notification-content.ts` (`"message.received"` added to the frontend's own
copy of the closed type union — the backend already emitted it since M17.5,
the web client did not know about it yet), and `pages/orders/orders-page.tsx`
(new `?orderId=` deep-link handling, so an `@` mention's "clickable through
to the order" and `sw.js`'s existing `notificationUrl()` both actually land
on the order instead of just the bare list).

**Frontend decisions worth knowing before touching this again:**

- **`ThreadViewFrame` (`thread-view-frame.tsx`) is `position: fixed` on
  mobile, `flex-1`/`static` on desktop — not a stylistic choice.** The Mobile
  shell is "a fixed header + _scrolling document_ + fixed bottom nav"
  (`globals.css`'s own comment on `.mobile-main`): there is no bounded-height
  region to hand a chat's internal scroll to, unlike the Desktop shell's
  `<main>` (a real `overflow-auto` flex box). Fixed, pinned between the same
  `--mobile-header-total`/`--mobile-nav-total` custom properties the header/nav
  bars use, is what gives the message list its own scroll region on mobile
  without fighting the shell.
- **A vendor's order-mention card is not a link.** `OrderReference` carries
  `orderId`, but the vendor's own order route is keyed by `groupId`
  (`/vendor/orders/:groupId`), and nothing in this payload maps one to the
  other. Staff mentions link to `/orders?orderId=…` (the new deep link);
  a vendor's chip renders unlinked rather than guessing.
- **Polling is one flat 15s loop, not two.** The handoff also asks for a
  refetch "when a `message.received` notification arrives" — wiring that in
  would mean a new cross-feature event bus for a single consumer (the
  notification bell's own poll runs independently, with nothing to subscribe
  to client-side). A 15s ceiling already bounds the same staleness a
  notification-triggered refetch would fix, so `use-message-thread.ts` stays
  one loop, documented at the call site.
- **The composer never optimistically renders a sent message.** It appends
  whatever `POST /threads/:id/messages` actually returns, after it returns —
  simpler, and matches how order creation works elsewhere in this app.

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

M17.5 and M17.6 are done (see §2 for what landed in each). What is left:

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

**The M17.6 web UI has never rendered behind a real login.** The database was
still unmigrated in the session that wrote it, so there was no way to
authenticate and click through `MessagingPage`/`VendorMessagesPage` in a
browser. What _was_ checked: `tsc --noEmit` and `eslint` clean on
`apps/web`, the full existing web test suite still green (see below), the
dev server boots with an empty console (`preview_start` → the login screen
renders, RTL, no errors) confirming the new routes/imports don't break the
bundle, and two new unit-test files
(`features/messaging/use-message-thread.test.ts`,
plus new cases in `features/notifications/notification-content.test.ts`)
covering the trickiest pure logic (newest-first→oldest-first reordering,
`loadOlder` prepending, the `message.received` payload→text rendering). No
component test exists yet for `ThreadView`/`MessageComposer`/either page —
that, and an actual click-through once the database is up, are the
highest-value things to do before trusting this UI in front of a real user.
The mobile `ThreadViewFrame` fixed-position layout in particular (see the
Web files section above) was reasoned through from `globals.css`, never
visually confirmed on a phone-width viewport.

**Pre-existing red gates** (confirmed failing on a clean tree, unrelated to this
work — a background task was filed for them):

- `apps/api/src/modules/products/presentation/products.controller.test.ts:62`
  — TS2741, the `ServiceMock` is missing `listMyVendorProducts`. This makes the
  whole API type-check fail, so filter it out when checking your own work.
- `apps/api/src/modules/shipping/infrastructure/shipping.repository.test.ts`
  — 10 of 29 tests fail.
- `apps/web/src/pages/finance/finance-page.test.tsx` — 2 of its tests fail
  ("lists purchase orders, filters by status, and creates one",
  "records an expense from the dialog"). Confirmed pre-existing by stashing
  the M17.6 changes and re-running against the clean tree — identical failure,
  nothing here touches finance.
- `apps/web/src/app.test.tsx` — "toggles language (direction) and theme via
  the Mobile More sheet" fails the same way on the clean tree. Also confirmed
  by the same stash-and-rerun; adding a `/messages` row to the More sheet did
  not cause it.

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
a real Postgres, and clicking through the M17.6 web UI as both a staff member
and a vendor for the first time, is worth more than starting M17.7 on top of
unverified foundations.
