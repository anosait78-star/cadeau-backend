/**
 * Which orders may be mentioned in a conversation, and how the `@` query is
 * read (EPIC-17 · M17.4).
 *
 * Pure decisions, testable without a database. The scope rule is the important
 * one and it is the same for both sides of a conversation: an order is
 * mentionable in a vendor's thread exactly when that vendor has a group in it
 * (`OrderVendorGroup` for the thread's warehouse).
 *
 * Applying it to staff as well as to vendors is deliberate. A vendor obviously
 * must not reach another vendor's orders. But a staff member typing `@` in
 * Cairo's thread must not accidentally paste Alexandria's order number into it
 * either — the mention is rendered to the vendor, so an unscoped picker would
 * turn a slip of the finger into a disclosure.
 */

/** Most orders the `@` picker returns for one query. */
export const MENTION_SEARCH_LIMIT = 10;

/** Most orders one message may point at. */
export const MAX_ORDER_REFS_PER_MESSAGE = 10;

/** Longest `@` query accepted; anything more is a paste, not a search. */
export const MAX_MENTION_QUERY_LENGTH = 64;

/** How the `@` query should be run against the mentionable orders. */
export type MentionSearch =
  | { readonly kind: "all" }
  | { readonly kind: "number"; readonly orderNumber: string }
  | { readonly kind: "text"; readonly text: string };

/**
 * Reads what the user typed after `@`.
 *
 * A digits-only query is matched against the order number, which is what
 * people actually type; anything else falls back to a text search over the
 * customer's name. An empty query lists the most recent orders, so opening the
 * picker shows something useful before a single character is typed.
 *
 * A leading `#` is stripped because order numbers are displayed with one, and
 * typing `@#1023` is the natural thing to do.
 */
export function parseMentionQuery(raw: string | undefined): MentionSearch {
  const trimmed = (raw ?? "").trim().replace(/^#/, "");
  if (trimmed.length === 0) return { kind: "all" };
  if (/^\d+$/.test(trimmed)) return { kind: "number", orderNumber: trimmed };
  return { kind: "text", text: trimmed.slice(0, MAX_MENTION_QUERY_LENGTH) };
}

/**
 * The ids a message may actually reference, given what the caller asked for
 * and what the thread's warehouse turned out to allow.
 *
 * Returns the ids that are *not* allowed rather than a boolean, so the caller
 * can refuse without having to re-derive which ones were the problem.
 */
export function rejectedOrderIds(
  requested: readonly string[],
  allowed: readonly string[],
): string[] {
  const permitted = new Set(allowed);
  return [...new Set(requested)].filter((id) => !permitted.has(id));
}
