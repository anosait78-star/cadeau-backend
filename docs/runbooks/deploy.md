# Deploy Runbook

How a change actually reaches production today: commit → push → pull/build on the
box → verify. Backend and frontend are **two separate repositories** and **two
separate deploys**, and they are not symmetrical — read the section you need.

> **Order matters: backend first, then frontend.** New API fields ship as
> optional, so the old bundle keeps working against the new API for the minutes
> between the two deploys. The reverse order breaks: a new bundle sending fields
> the live API rejects fails validation.

For undoing a bad deploy, see [rollback.md](./rollback.md).

---

## 0. The lay of the land

|                | Backend                                         | Frontend                                       |
| -------------- | ----------------------------------------------- | ---------------------------------------------- |
| Repo           | `anosait78-star/cadeau-backend` (this monorepo) | `anosait78-star/cadeau-front`                  |
| Branch         | `feat/epic-15-notifications`                    | `main`                                         |
| Path on server | `~/cadeau-backend`                              | `~/cadeau-front`                               |
| Layout         | monorepo (`apps/api`, `apps/web`, `packages/*`) | flat mirror of `apps/web` (`src/` at the root) |
| Served by      | pm2 app `cadeau-api` → `127.0.0.1:3003`         | nginx static root `/var/www/crm`               |
| Public URL     | `https://crmapi.cadeauegypt.com`                | `https://crm.cadeauegypt.com`                  |

Both moved off `nosait.com` on 2026-09-26, frontend first, then the API. The
old hosts still answer — same web root, same pm2 app — and stay up as a safety
net until the new ones have been used in anger, then become redirects. Bosta is
unaffected by the API move: we call them, they never call us (there is an
inbound webhook route in the code, but no URL is registered on their side). The
**storefront still posts orders to `crmapi.nosait.com`** and is the one caller
left to repoint.

SSH:

```bash
ssh -i $env:USERPROFILE\.ssh\claude-agent claude@76.13.63.162
```

Three things that will bite you if you assume otherwise:

- **The API is on port 3003, not 3000.** Port 3000 on this box belongs to an
  unrelated Next.js site. Curling `localhost:3000/v1/health` returns _that_ app's
  404 page, which looks like the API is broken when it is fine. Confirm with
  `grep proxy_pass /etc/nginx/sites-enabled/crmapi.cadeauegypt.com`.
- **`/var/www/crm` is a plain copy of `dist/`, not a symlink.** Building in
  `~/cadeau-front` changes nothing on the live site until you copy the files over.
- **The server has no GitHub push credentials.** It can `pull`/`fetch` but
  `git push` fails with `could not read Username for 'https://github.com'`. Push
  from your own machine; see §2.5.

---

## 1. Backend

### 1.1 Commit and push (local machine)

Stage only `apps/api` (and `packages/*` if touched) so the web change stays a
separate commit:

```bash
git add apps/api/src/...
git commit -m "feat(shipping): ..."
```

A husky + lint-staged hook runs `eslint --fix` and `prettier --write` on staged
files and folds the result into the commit. If it rewrites something, that is
expected — re-read the diff before pushing.

```bash
git push origin feat/epic-15-notifications
```

Note the commit you are replacing (`git rev-parse --short HEAD` **before** the
new commit) — that is your app-rollback point.

### 1.2 Pull on the server

```bash
cd ~/cadeau-backend
git pull --ff-only origin feat/epic-15-notifications
```

Use `--ff-only`. The checkout carries **server-local state that must survive**:

- `pnpm-workspace.yaml` — modified on the server (adds `onlyBuiltDependencies`)
- `ecosystem.config.js` — untracked, the pm2 definition
- `pnpm-lock.yaml.server-backup` — untracked

A fast-forward leaves all three alone. If a pull ever wants to merge or would
touch those files, stop and resolve it deliberately rather than forcing.

Confirm afterwards:

```bash
git status --short   # expect: M pnpm-workspace.yaml, ?? ecosystem.config.js, ?? pnpm-lock.yaml.server-backup
```

### 1.3 Build

```bash
cd ~/cadeau-backend
pnpm --filter @cadeau/api build
```

Skip `pnpm install` unless the change adds or bumps a dependency — installing is
the riskiest step on a live box and most commits do not need it.

A `[WARN] The "pnpm" field in package.json is no longer read by pnpm` line is
normal noise on pnpm 11.

### 1.4 Verify the build before restarting

Cheap and it catches a stale or partial build while the old process is still
serving traffic. Grep the compiled output for something your change introduced:

```bash
grep -c "addressLine" apps/api/dist/modules/shipping/presentation/dto/shipping.dto.js
```

### 1.5 Restart and verify

```bash
pm2 restart cadeau-api --update-env
pm2 list                                   # status online, restart count +1 (not climbing)
curl -s http://127.0.0.1:3003/v1/health    # {"status":"ok",...}
curl -s https://crmapi.cadeauegypt.com/v1/health
```

Then check nothing new is erroring — and check the **timestamps**, because this
log keeps old entries and it is easy to panic at an error from days ago:

```bash
pm2 logs cadeau-api --lines 30 --nostream --err
```

A guarded route answering `401` to an unauthenticated request is a healthy sign:
the route exists and the guard is up.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://crmapi.cadeauegypt.com/v1/shipping/shipments -H 'Content-Type: application/json' -d '{}'
```

---

## 2. Frontend

`cadeau-front` is a **flat mirror** of `apps/web`: monorepo
`apps/web/src/x/y.ts` lives at `src/x/y.ts` there. The monorepo remains the
source of truth; the mirror exists so the box can build the site without the
whole workspace.

### 2.1 Commit the web change in the monorepo first

```bash
git add apps/web/src/...
git commit -m "feat(web): ..."
git push origin feat/epic-15-notifications
```

### 2.2 Check for divergence before copying anything

Copying blindly would silently discard any frontend-only fix that never made it
back to the monorepo. Prove the mirror is clean by comparing it against the
monorepo **as it was before your change** — identical means safe to overwrite:

```bash
cd ~/cadeau-backend
for f in features/shipping/select-carrier-dialog.tsx i18n/dictionaries.ts; do
  printf '%-50s ' "$f"
  git show <PRE_CHANGE_SHA>:apps/web/src/$f | diff -q - ~/cadeau-front/src/$f >/dev/null 2>&1 \
    && echo 'clean mirror' || echo 'DIVERGED — investigate'
done
```

Anything reported `DIVERGED` must be reconciled by hand before you continue.

### 2.3 Mirror the changed files

Pull the monorepo on the server so it holds your web commit, then copy just the
files you changed (never the whole tree — the layouts differ):

```bash
cd ~/cadeau-backend && git pull --ff-only origin feat/epic-15-notifications
cp ~/cadeau-backend/apps/web/src/i18n/dictionaries.ts ~/cadeau-front/src/i18n/dictionaries.ts
# ...one cp per changed file
cd ~/cadeau-front && git status --short -- src/   # exactly the files you meant
```

### 2.4 Build

```bash
cd ~/cadeau-front
pnpm build
```

`pnpm type-check` **fails on the server** with `Cannot find type definition file
for 'node'` — `@types/node` is not installed there. It is pre-existing and
unrelated to any given change (verify with `git stash`, re-run, `git stash pop`).
`pnpm build` is `vite build` and does not typecheck. Do your typechecking and
tests in the monorepo before you get here.

The build prints the new hashed bundle name — keep it, you will verify it:

```
dist/assets/index-k32kv30U.js   915.27 kB
```

### 2.5 Push the mirror commit (from your machine)

The server cannot push. Commit there if you like, but the authoritative push
comes from a local clone:

```bash
git clone --depth 5 https://github.com/anosait78-star/cadeau-front.git front-mirror
# copy the same files from apps/web/src into front-mirror/src
cd front-mirror && git add -A src/
git commit -m "feat(web): ... (mirrors cadeau-backend@<SHA>)"
git push origin main
```

Reference the monorepo commit in the message — `(mirrors cadeau-backend@1cf2840)`
— that back-link is the only thread tying the two repos together.

Then align the server (content is already identical, so this only fixes the SHA;
untracked `dist/`, `node_modules/` and `.env.production` are untouched):

```bash
cd ~/cadeau-front
git fetch origin main
git diff --stat HEAD origin/main -- src/   # expect empty
git reset --hard origin/main
```

### 2.6 Publish to the web root

nginx serves `/var/www/crm`, which is a **copy**. Back it up, then replace:

```bash
BK=~/backups/crm-frontend-$(date +%Y%m%d-%H%M%S)
mkdir -p "$BK" && cp -r /var/www/crm/. "$BK"/

rm -rf /var/www/crm/assets
cp -r ~/cadeau-front/dist/. /var/www/crm/
```

**Fix the permissions.** This `cp` has produced `----r-xr-x` (owner cannot even
read). nginx still serves it via the "other" bits, so the site looks fine and the
breakage only shows up later:

```bash
chmod 755 /var/www/crm /var/www/crm/assets
chmod 644 /var/www/crm/index.html /var/www/crm/assets/*
ls -la /var/www/crm/assets   # expect -rw-r--r--
```

### 2.7 Verify

Confirm `index.html` points at the **new** hash and that the served bundle really
contains your change — this is what proves the deploy landed, not just that the
build succeeded:

```bash
curl -s https://crm.cadeauegypt.com/ | grep -o 'assets/[^"]*'
curl -s -o /dev/null -w '%{http_code}\n' https://crm.cadeauegypt.com/assets/index-<HASH>.js
curl -s https://crm.cadeauegypt.com/assets/index-<HASH>.js | grep -c addressLine
```

Then load the app and click through the screen you changed. A bundle containing
the right strings is strong evidence, not proof that the UI behaves.

---

## 3. Environment variables, and adding a domain

### 3.1 Editing `.env.production` does nothing on its own

pm2 keeps its own copy of the environment each app was launched with, and
reuses it on every restart. `.env.production` is read at launch, not at
restart, and `ecosystem.config.js` has only a small inline `env` block — so a
variable you change in the file is still the old value in the running process.
`pm2 restart cadeau-api --update-env` does not fix this either: `--update-env`
takes the environment of _your shell_, not of the file.

Load the file into the shell first, then restart, then persist:

```bash
cd ~/cadeau-backend && set -a && . ./.env.production && set +a \
  && pm2 restart cadeau-api --update-env && sleep 8 \
  && pm2 env 0 | grep YOUR_VARIABLE
pm2 save   # only after the app checks out — this is what survives a reboot
```

`pm2 env 0` is the only honest check: it shows what the process actually holds.
Because this replaces the whole environment, confirm a route that needs the
database still answers before you call it done — `401` is the healthy answer
here, `500` means something dropped out:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://crmapi.cadeauegypt.com/v1/orders
```

### 3.2 Adding a domain to the frontend

What `crm.cadeauegypt.com` took, in order (2026-09-26):

1. **DNS** — an A record to this box. If the zone is on Cloudflare, set it to
   **DNS only** (grey cloud): proxied records answer with Cloudflare's own IPs,
   which breaks certbot's HTTP challenge, and a proxied host on SSL mode
   _Flexible_ redirect-loops against our HTTPS redirect. Re-proxying later needs
   SSL mode **Full (strict)**, which the certificate below satisfies.
   `dig +short <host>` must show the box's IP before going on.
2. **nginx** — derive the new site from the live one rather than writing it
   fresh, so the cache rules travel with it, but drop certbot's lines or the
   config will not load (it points at a certificate that does not exist yet):

   ```bash
   sudo awk 'NR==1,/^}/' /etc/nginx/sites-available/crm.nosait.com \
     | sed -e 's/crm\.nosait\.com/<new host>/g' \
           -e '/managed by Certbot/d' \
           -e 's/^    server_name/    listen 80;\n    server_name/' \
     | sudo tee /etc/nginx/sites-available/<new host>
   sudo ln -sfn /etc/nginx/sites-available/<new host> /etc/nginx/sites-enabled/<new host>
   sudo nginx -t && sudo systemctl reload nginx
   ```

3. **Certificate** — `sudo certbot --nginx -d <new host>`, answering
   _Redirect_. Certbot rewrites the port-80 block into 443 and adds the
   redirect, keeping the locations.
4. **CORS** — the API rejects any origin not in `CORS_ALLOWED_ORIGINS`, so
   without this the site loads and every request inside it fails. Add the new
   origin (comma-separated, no spaces) and restart per §3.1, then prove it:

   ```bash
   curl -s -i -H 'Origin: https://<new host>' \
     https://crmapi.cadeauegypt.com/v1/health | grep -i access-control-allow-origin
   ```

   No header means the origin was refused. Use a plain GET — `curl -I` sends
   HEAD, which comes back without the header even when the origin is allowed.

Tell users to expect three things on a new domain, none of them faults: they
are logged out (sessions are per-origin), push notifications must be re-enabled
per person per device, and an installed PWA has to be reinstalled from the new
URL.

---

## 4. Windows / PowerShell notes

Running these over SSH from PowerShell has sharp edges that cost real time:

- PowerShell expands `$(...)` and `$var` **before** SSH sees them, so
  `date +%Y%m%d` becomes a `Get-Date` error. Wrap remote commands in **single**
  quotes, or put the script in a file and pipe it: `Get-Content s.sh -Raw | ssh ... "bash -s"`.
- Piping a file written on Windows sends CRLF and a BOM; bash then reports
  `$'\r': command not found` and `﻿#!/usr/bin/env: No such file`. Convert to LF
  and write UTF-8 **without** BOM before piping.
- Prefer `Invoke-WebRequest` over `curl` + `grep` when checking a URL from
  Windows — no quoting games.

---

## 5. Post-deploy checklist

- [ ] Backend rollback SHA recorded, frontend rollback SHA recorded.
- [ ] `/var/www/crm` backed up to `~/backups/` before overwriting.
- [ ] `git status --short` on `~/cadeau-backend` still shows the three expected
      server-local entries.
- [ ] `https://crmapi.cadeauegypt.com/v1/health` returns `ok`.
- [ ] `pm2 list` shows `cadeau-api` online and the restart count is not climbing.
- [ ] `index.html` references the new bundle hash and it returns `200`.
- [ ] Web-root files are `-rw-r--r--`.
- [ ] The changed screen exercised by hand in the browser.
