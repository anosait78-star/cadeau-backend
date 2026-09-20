import {
  getVapidPublicKey,
  registerPushSubscription,
  removePushSubscription,
} from "./notifications-api";

/**
 * Turning Web Push on and off for the device in front of the user.
 *
 * The pieces either side of this were already built: the server signs and
 * sends with VAPID, and `public/sw.js` shows what arrives. This is the middle
 * — asking permission, subscribing through the service worker, and handing
 * the resulting endpoint to the server so it has somewhere to send.
 */

/** Why push is unavailable, or that it is on. */
export type PushState =
  /** No service worker or no Push API — an old browser, or an iOS tab that is not an installed app. */
  | "unsupported"
  /** Supported, permission never asked or asked and dismissed. */
  | "idle"
  /** The user said no. Only they can undo this, in the browser's own site settings. */
  | "denied"
  /** Subscribed on this device. */
  | "enabled";

/** Whether this browser can do Web Push at all. */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * A base64url VAPID key as the `Uint8Array` `pushManager.subscribe` wants.
 * The Push API predates browsers accepting the string form, and Safari still
 * requires the buffer.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * What this device's current state is, without prompting for anything.
 *
 * A subscription the browser is holding is also re-registered with the server
 * in the background. The browser's copy and the server's row can fall out of
 * step in several ordinary ways — the registering request never landed, the
 * push service retired the endpoint and the row was pruned, the user moved to
 * another company — and every one of them looks identical from here: the app
 * says "enabled" while nothing can ever be delivered. Re-registering is an
 * idempotent upsert on the endpoint, so repairing it costs one request and
 * removes a state no one could otherwise get out of.
 */
export async function getPushState(): Promise<PushState> {
  if (!isPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing !== null && Notification.permission === "granted") {
      void syncSubscription(existing);
      return "enabled";
    }
  } catch {
    // A worker that never became ready is indistinguishable from not subscribed.
  }
  return "idle";
}

/** Re-register a subscription the browser already holds. Best effort. */
async function syncSubscription(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  const p256dh = json.keys?.["p256dh"];
  const auth = json.keys?.["auth"];
  if (p256dh === undefined || auth === undefined) return;
  try {
    await registerPushSubscription({
      endpoint: subscription.endpoint,
      keys: { p256dh, auth },
      userAgent: navigator.userAgent,
    });
  } catch {
    // Offline, or a server that already knows: either way nothing to report.
  }
}

/**
 * Ask permission, subscribe, and register the endpoint with the server.
 *
 * Resolves to the state the device ended in, so the caller can tell a refusal
 * ("denied") from a success without catching anything. A subscription that
 * already exists is reused and re-registered: the server upserts on endpoint,
 * so this repairs a device whose row was pruned after the push service
 * retired it.
 */
export async function enablePush(): Promise<PushState> {
  if (!isPushSupported()) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "idle";

  const { publicKey } = await getVapidPublicKey();
  const registration = await navigator.serviceWorker.ready;

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      // Required to be true by every browser that ships Push: a push may only
      // arrive if it results in a notification the user can see.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));

  const json = subscription.toJSON();
  const p256dh = json.keys?.["p256dh"];
  const auth = json.keys?.["auth"];
  if (p256dh === undefined || auth === undefined) {
    // A subscription without its keys cannot be encrypted to. Drop it rather
    // than registering an endpoint that could never receive anything.
    await subscription.unsubscribe().catch(() => undefined);
    return "idle";
  }

  await registerPushSubscription({
    endpoint: subscription.endpoint,
    keys: { p256dh, auth },
    userAgent: navigator.userAgent,
  });

  return "enabled";
}

/**
 * Unsubscribe this device and forget it server-side.
 *
 * `subscriptionId` is the row the server returned when this device
 * registered; without it the browser still unsubscribes, and the server
 * prunes the dead endpoint on its next send (a push service answers 404/410
 * for a retired endpoint, which `WebPushAdapter` already handles).
 */
export async function disablePush(subscriptionId?: string): Promise<PushState> {
  if (!isPushSupported()) return "unsupported";
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription !== null) await subscription.unsubscribe();
  } catch {
    // Already gone; the server-side removal below is what matters.
  }
  if (subscriptionId !== undefined) {
    await removePushSubscription(subscriptionId).catch(() => undefined);
  }
  return Notification.permission === "denied" ? "denied" : "idle";
}
