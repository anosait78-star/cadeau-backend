/** A W3C Web Push subscription's connection details. */
export interface PushSubscriptionTarget {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/**
 * Raised by a {@link PushSenderPort} when the push service reports the
 * subscription is gone (HTTP 404/410) — the browser unsubscribed, the
 * endpoint expired, or the user revoked permission. The caller drops the
 * subscription instead of retrying.
 */
export class PushSubscriptionGoneError extends Error {
  constructor() {
    super("The push subscription no longer exists.");
    this.name = "PushSubscriptionGoneError";
  }
}

/**
 * Port for sending one Web Push message (EPIC-15, decision D4). The only
 * bound implementation is `WebPushAdapter` (`web-push`, VAPID-authenticated).
 */
export interface PushSenderPort {
  /** Sends `payload` (JSON-serialized) to the browser's push service. Throws on failure. */
  send(target: PushSubscriptionTarget, payload: unknown): Promise<void>;
}

/** DI token for {@link PushSenderPort}. */
export const PUSH_SENDER = Symbol("PUSH_SENDER");
