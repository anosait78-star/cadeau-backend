/*
 * Minimal service worker. Its jobs are (a) satisfying the browser's
 * installability criteria — a same-origin worker with a `fetch` handler is
 * required before `beforeinstallprompt` fires — and (b) serving the app shell
 * from cache when the device is offline.
 *
 * It deliberately does NOT cache API responses: a stale `/v1` payload is a much
 * worse bug than a missing offline page, and the CRM is online-first (ADR-001
 * keeps the server authoritative).
 */
const SHELL_CACHE = "cadeau-shell-v2";
const SHELL_URL = "/index.html";

self.addEventListener("install", (event) => {
  // Fetch the shell up front, so the very first offline launch has something to
  // render rather than needing one successful online navigation first.
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(SHELL_CACHE);
        await cache.add(new Request(SHELL_URL, { cache: "reload" }));
      } catch {
        // A failed precache only costs the first offline launch; never block install.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== SHELL_CACHE).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/*
 * Web Push (EPIC-15). The server sends `{ title, body, payload }`, where
 * `payload.orderId` names the order the notification is about.
 *
 * A push event must result in a visible notification: browsers permit a
 * handful of silent pushes and then revoke the permission outright, so every
 * branch here — including a payload that will not parse — shows something.
 */
const PUSH_TAG = "cadeau-notification";

self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    // A payload we cannot read still has to surface, or the browser counts it
    // as a silent push against us.
  }

  const title =
    typeof message.title === "string" && message.title !== "" ? message.title : "Cadeau CRM";
  const body = typeof message.body === "string" ? message.body : "";
  const payload = message.payload && typeof message.payload === "object" ? message.payload : {};

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // Collapse repeats of the same order into one entry rather than stacking
      // a tray full of near-identical lines.
      tag: typeof payload.orderId === "string" ? `order-${payload.orderId}` : PUSH_TAG,
      renotify: true,
      data: { url: notificationUrl(payload) },
    }),
  );
});

/** Where a tap should land: the order it concerns, or the dashboard. */
function notificationUrl(payload) {
  return typeof payload.orderId === "string" && payload.orderId !== ""
    ? `/orders?orderId=${encodeURIComponent(payload.orderId)}`
    : "/";
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const url = new URL(target, self.location.origin);
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Reuse a tab that already has the app open — opening a second copy of a
      // CRM the user is already working in is its own small annoyance.
      for (const client of clients) {
        if (new URL(client.url).origin === url.origin) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url.href);
          return;
        }
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});

/**
 * Build output only. Vite fingerprints everything under `/assets/`, so a new
 * build produces new URLs and these entries can never go stale — which is what
 * makes caching them safe, unlike the unhashed files around them.
 */
function isBuildAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/assets/");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  // The shell: network-first, so a running app always gets the newest HTML, with
  // the cached copy as the offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          await cache.put(SHELL_URL, fresh.clone());
          return fresh;
        } catch (error) {
          const cached = await caches.match(SHELL_URL);
          if (cached !== undefined) return cached;
          throw error;
        }
      })(),
    );
    return;
  }

  // Build assets: cache-first. Without these the offline shell would render an
  // empty page — it references a bundle that is not there.
  const url = new URL(request.url);
  if (!isBuildAsset(url)) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached !== undefined) return cached;
      const fresh = await fetch(request);
      if (fresh.ok) {
        const cache = await caches.open(SHELL_CACHE);
        await cache.put(request, fresh.clone());
      }
      return fresh;
    })(),
  );
});
