/**
 * The order state machine (EPIC-11, docs/epic-11-design.md §6).
 *
 * The 12 lifecycle states plus the transition graph, expressed as pure data +
 * functions so the rules are trivially unit-testable and free of I/O. This is
 * the fixed default machine (P0); a per-company configurable machine (P1) will
 * layer over the same shape without changing callers.
 *
 * The follow-up state is a **separate axis** — it is set and cleared without a
 * main-status transition and never gates the machine.
 */

/** The 12 lifecycle states (04_Orders.md §ج), in lifecycle order. */
export const ORDER_STATUSES = [
  "new",
  "confirming",
  "processing",
  "incomplete",
  "ready",
  "shipped",
  "delivered",
  "completed",
  "postponed",
  "cancelled",
  "returned",
  "exchanged",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** The separate follow-up axis (matches the `orders_follow_up_check` CHECK). */
export const FOLLOW_UP_STATES = ["none", "pending", "contacted", "scheduled", "no_answer"] as const;

export type FollowUpState = (typeof FOLLOW_UP_STATES)[number];

/** Payment status is derived from `collectedAmount` vs `total`. */
export const PAYMENT_STATUSES = ["unpaid", "partial", "paid"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * The default legal transitions. A `from` state maps to the set of `to` states
 * it may move to; a state absent from a `from`'s set is illegal (→ `422`).
 * `cancelled` and `exchanged` are terminal (empty sets).
 */
const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  new: ["confirming", "processing", "cancelled", "postponed"],
  confirming: ["processing", "incomplete", "cancelled", "postponed"],
  processing: ["incomplete", "ready", "cancelled", "postponed"],
  incomplete: ["processing", "ready", "cancelled", "postponed"],
  ready: ["shipped", "cancelled", "postponed"],
  shipped: ["delivered", "returned", "postponed"],
  delivered: ["completed", "returned", "exchanged"],
  completed: ["returned", "exchanged"],
  postponed: ["new", "confirming", "processing", "ready", "cancelled"],
  cancelled: [],
  returned: ["exchanged"],
  exchanged: [],
};

/** The stock side effect a transition triggers on entry (feature-gated at runtime). */
export type StockEffect = "reserve" | "ship" | "release" | "none";

/**
 * States that hold a live stock reservation (committed-but-not-shipped): the
 * order reserved at `processing` and has not yet shipped, cancelled or returned.
 */
const RESERVING_STATES: ReadonlySet<OrderStatus> = new Set([
  "processing",
  "incomplete",
  "ready",
  "postponed",
]);

export function isValidStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

export function isValidFollowUpState(value: string): value is FollowUpState {
  return (FOLLOW_UP_STATES as readonly string[]).includes(value);
}

/** Whether `to` is a legal next state from `from` in the default machine. */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The states reachable from `from` (for the UI's allowed-transition hints). */
export function nextStates(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

/**
 * The stock side effect of entering `to` from `from`:
 *
 * - `reserve` — entering `processing` from a non-reserving state: commit stock.
 * - `ship`    — entering `shipped`: decrement on-hand and release the reservation.
 * - `release` — entering `cancelled`/`returned` while a pre-ship reservation is
 *               still held: give the committed units back.
 * - `none`    — everything else (including a move between reserving states).
 */
export function stockEffectOf(from: OrderStatus, to: OrderStatus): StockEffect {
  if (to === "processing" && !RESERVING_STATES.has(from)) return "reserve";
  if (to === "shipped") return "ship";
  if ((to === "cancelled" || to === "returned") && RESERVING_STATES.has(from)) return "release";
  return "none";
}

/** Whether cancelling into `to` requires a `cancel`-kind reason (cancel does). */
export function requiresReason(to: OrderStatus): boolean {
  return to === "cancelled";
}

/** Derive the payment status from the collected amount and the order total. */
export function derivePaymentStatus(collectedAmount: number, total: number): PaymentStatus {
  if (collectedAmount <= 0) return "unpaid";
  if (collectedAmount >= total) return "paid";
  return "partial";
}

/**
 * Whether a supplied `paymentStatus` is consistent with `collectedAmount` for
 * this order's `total` (the create-time contract): `paid` requires
 * `collectedAmount >= total`, `unpaid` requires `collectedAmount <= 0`, and
 * `partial` requires the amount strictly between the two.
 */
export function isConsistentPaymentStatus(
  status: PaymentStatus,
  collectedAmount: number,
  total: number,
): boolean {
  return status === derivePaymentStatus(collectedAmount, total);
}
