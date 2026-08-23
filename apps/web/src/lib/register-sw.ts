/**
 * Registers the app-shell service worker (`public/sw.js`).
 *
 * The registration is what makes the app *installable*: browsers only fire
 * `beforeinstallprompt` — the event behind the "install app" button — once a
 * same-origin worker with a `fetch` handler controls the page, alongside the
 * web manifest linked from `index.html`.
 *
 * Failures are swallowed on purpose: an unsupported browser or a blocked
 * registration must never break the app, it only means no install button.
 */
export function registerServiceWorker(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // No service worker → no offline shell and no install prompt. Nothing else breaks.
    });
  });
}
