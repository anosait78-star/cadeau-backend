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
| M17.6     | `8a7f04c` | Web UI: staff thread list/panel, vendor tab, composer, `@` picker, lightbox             |
| fix       | `bc44f7e` | Boot-safe storage fallback — see §2b, this is what is actually live in production       |

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

## 2b. Production status (live as of 2026-09-23)

M17.1–M17.6 plus the `bc44f7e` fix are **deployed and verified against a real
login** on `crmapi.nosait.com` / `crm.nosait.com` — Ahmed clicked through
`/messages` himself (thread list, empty state, "new conversation" picker all
rendered correctly in Arabic). This section is what a later session needs to
know about that live state; §5 below still lists what is _not_ yet verified.

**Image attachments are deliberately OFF in production right now.** No
object-storage credentials exist yet (S3-compatible — Cloudflare R2,
Backblaze B2, DigitalOcean Spaces — or a bespoke Cloudinary adapter, still
undecided). `fileStorageProvider` serves `DisabledFileStorage` in this state:
text-only messaging works fully; `POST /messaging/attachments` returns a
clean `503 SERVICE_UNAVAILABLE` and the composer shows a toast instead of a
silent failure (see the `bc44f7e` commit message and
`file-storage.provider.ts`'s doc comment). **To turn images on**: set
`S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY` in `~/cadeau-backend/.env.production` on the server and
`pm2 restart cadeau-api --update-env` — no code or migration change needed.

**Two deploy steps this repo's own runbook did not mention, both now real
gaps in `docs/runbooks/deploy.md`** (worth fixing there separately):

1. **`pnpm --filter @cadeau/database db:seed` must run after every
   `db:migrate:deploy`.** The migration only creates tables/RLS; the actual
   `messaging` feature row, its three permission rows, and the template
   grants (owner/manager/store_manager/vendor) live in
   `packages/database/src/seed/access/catalog.ts` and only reach the database
   via the seed. Skipping it means the tables exist but the feature is
   invisible to every company — that is exactly what happened here, and cost
   most of the debugging time. The seed is idempotent and safe to (re-)run in
   any environment (its own doc comment says so); it found 21 pending changes
   the first time it ran against this production database, meaning **several
   earlier epics' catalog entries were also never seeded** — worth an
   explicit audit later, not just messaging's.
2. **The API's in-process capability cache does not know about a change made
   directly in the database.** `admin.controller.ts`'s own doc comment notes
   the cache is invalidated "on change" — but only for changes made through
   the admin service. A seed run (or any other direct DB write) needs
   `pm2 restart cadeau-api` afterward, or affected users see stale
   capabilities until the cache's own TTL/eviction catches up.

**Server-side state changed by this deploy, beyond the application code:**

- `~/cadeau-backend/pnpm-workspace.yaml`'s `onlyBuiltDependencies` gained
  `sharp` (needed once, to let its install script fetch the right platform
  binary under pnpm's build-script allowlist). This file is server-local,
  untracked-by-intent — expect it to keep drifting from git across deploys.
- The `crmuser` database role was granted `CREATE` on the `app` schema — the
  messaging migration adds one function there
  (`app.current_member_warehouse_id()`) and the role only had `USAGE`
  before. One-time; nothing to redo.
- A full `pg_dump` of the `orderflow` database was taken before the migration
  ran, as the `postgres` superuser (the app's own role cannot dump past its
  own RLS — `FORCE ROW LEVEL SECURITY` blocks even the table owner without
  `BYPASSRLS`): `~/backups/orderflow-pre-messaging-20260923-100729.dump`
  (`pg_restore`-format, 70 tables, ~2MB). Kept for now; not on any retention
  schedule.
- Frontend mirror (`anosait78-star/cadeau-front`) is at commit `02333ef`,
  mirroring `bc44f7e`. `/var/www/crm` was backed up to
  `~/backups/crm-frontend-20260923-105438` before the new bundle
  (`index-CFZH5NHD.js`) was published.

**Rollback points**, if a later change needs to back out cleanly: backend
`d172637` (last commit before any EPIC-17 code reached the server — the exact
`git reset --hard` target used mid-session when the first deploy attempt
crash-looped), frontend `841c42a` (`cadeau-front`'s prior `main`). The
database migration is additive-only (Expand, no Contract), so an older app
version keeps working against the newer schema per `docs/runbooks/rollback.md`
§2's compatibility rule — no database rollback is needed alongside an
application rollback here.

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

**Superseded by §2b:** the migration is applied, the RLS policies and the
web UI have both been exercised against the real production database and a
real login. What is left genuinely unverified:

- **The RLS isolation claim itself** ("vendor A cannot read vendor B's
  thread, cannot mention an order that is not theirs") has not been tested
  with two actual competing vendor accounts — only with a single owner
  account (Ahmed/nosait) that sees everything by design. This is still the
  highest-value test to write, now against the live schema rather than a
  hypothetical one.
- The repository queries (especially the `vendorGroups: { some: … }` filter
  and the nulls-last keyset cursor) have run for real now (the thread list
  loaded), but only ever against zero/one rows — never paginated, never with
  concurrent writes.
- `S3FileStorage` still has never talked to a live bucket — moot until object
  storage credentials exist (§2b).
- No component test exists yet for `ThreadView`/`MessageComposer`/either
  page — `tsc`/`eslint`/the unit tests for the pure logic
  (`use-message-thread.test.ts`, `notification-content.test.ts`) are what
  back this UI, plus the one manual click-through in §2b.
- The mobile `ThreadViewFrame` fixed-position layout (bounded by
  `--mobile-header-total`/`--mobile-nav-total`) was reasoned through from
  `globals.css` and has not been visually confirmed on an actual phone-width
  viewport — the production click-through so far was desktop-width.

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

M17.1–M17.6 are live in production (§2b) — no local database setup is needed
just to keep going. The two open threads are independent and either is a
reasonable place to start:

- **Object storage**, so image attachments turn on (§2b: pick an
  S3-compatible provider — zero code change — or write a Cloudinary adapter
  against `FileStoragePort`, §2b's "Cloudinary" thread from the deploy
  session).
- **M17.7's quality gate** (§4) — now that the live system backs every claim
  in this document, the docs/tests it asks for describe something real
  instead of something planned.
