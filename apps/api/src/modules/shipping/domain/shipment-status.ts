/**
 * The shipment state machine (EPIC-12, docs/epic-12-design.md §6-equivalent).
 *
 * A much simpler lifecycle than orders' 12-state machine (docs/epic-11-design.md
 * §6): a shipment moves forward from `created` through pickup and transit to a
 * terminal outcome (`delivered`/`returned`/`cancelled`). Expressed the same way —
 * pure data + functions, no I/O — so the rules stay trivially unit-testable.
 */

/** The 6 shipment states, matching the `shipments_status_check` CHECK. */
export const SHIPMENT_STATUSES = [
  "created",
  "picked_up",
  "in_transit",
  "delivered",
  "returned",
  "cancelled",
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/**
 * The default legal transitions. `delivered`, `returned` and `cancelled` are
 * terminal (empty sets) — a shipment's outcome, once reached, does not change.
 */
const TRANSITIONS: Readonly<Record<ShipmentStatus, readonly ShipmentStatus[]>> = {
  created: ["picked_up", "cancelled"],
  picked_up: ["in_transit", "returned", "cancelled"],
  in_transit: ["delivered", "returned"],
  delivered: [],
  returned: [],
  cancelled: [],
};

/**
 * Order statuses a shipment may be created against (docs/epic-12-design.md §1:
 * "An order in `ready`/`shipped` needs a real dispatch"). Any earlier status
 * (the order isn't ready to leave yet) or later/terminal status (it already
 * concluded) is not shippable.
 */
const SHIPPABLE_ORDER_STATUSES: ReadonlySet<string> = new Set(["ready", "shipped"]);

export function isValidStatus(value: string): value is ShipmentStatus {
  return (SHIPMENT_STATUSES as readonly string[]).includes(value);
}

/** Whether `to` is a legal next state from `from` in the default machine. */
export function canTransition(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The states reachable from `from` (for the UI's allowed-transition hints). */
export function nextStates(from: ShipmentStatus): readonly ShipmentStatus[] {
  return TRANSITIONS[from];
}

/** Whether `status` is terminal (no further transition is legal). */
export function isTerminal(status: ShipmentStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Whether an order in `orderStatus` may have a shipment created against it. */
export function isShippableOrderStatus(orderStatus: string): boolean {
  return SHIPPABLE_ORDER_STATUSES.has(orderStatus);
}
