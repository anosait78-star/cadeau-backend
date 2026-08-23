/*
 * Minimal service worker. Its only jobs are (a) satisfying the browser's
 * installability criteria — a same-origin worker with a `fetch` handler is
 * required before `beforeinstallprompt` fires — and (b) serving the app shell
 * from cache when the device is offline.
 *
 * It deliberately does NOT cache hashed build assets or API responses: a stale
 * bundle or a stale `/v1` payload is a much worse bug than a missing offline
 * page, and the CRM is online-first (ADR-001 keeps the server authoritative).
 */
const SHELL_CACHE = "cadeau-shell-v1";
const SHELL_URL = "/index.html";

self.addEventListener("install", () => {
  void self.skipWaiting();
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Navigations only — everything else goes straight to the network, untouched.
  if (request.method !== "GET" || request.mode !== "navigate") return;

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
});
