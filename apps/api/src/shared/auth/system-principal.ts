import type { RequestPrincipal } from "./authenticated-request";

/**
 * The session id the storefront sync acts under. Its writes are attributed to
 * the admin who created the connection — right for the audit trail, which
 * needs a person — but that admin did not actually place or change the order.
 */
export const STOREFRONT_SYNC_SESSION = "storefront-sync";

/** Session ids of principals through which the system acts, not a signed-in person. */
const SYSTEM_SESSIONS: ReadonlySet<string> = new Set([STOREFRONT_SYNC_SESSION]);

/** Whether this principal is the system acting on someone's behalf. */
export function isSystemPrincipal(principal: RequestPrincipal): boolean {
  return SYSTEM_SESSIONS.has(principal.sessionId);
}

/**
 * The `actorId` a domain event should carry: the user for a person's action,
 * `null` for a system one.
 *
 * Subscribers skip "your own action" by comparing against `actorId`. Carrying
 * the connection's admin on storefront events made the notifications
 * subscriber drop that admin — in practice the owner — from every new-order
 * notification, so no one heard about a single storefront order. Audit
 * records keep `principal.userId`; only events use this.
 */
export function eventActorId(principal: RequestPrincipal): string | null {
  return isSystemPrincipal(principal) ? null : principal.userId;
}
