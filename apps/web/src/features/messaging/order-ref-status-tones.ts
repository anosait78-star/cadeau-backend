import type { BadgeTone } from "@/components/status-badge/status-badge";

/**
 * A mention card's status chip — same domain values as `orders.status.*`
 * (`ORDER_STATUS_TONE` in `pages/orders/orders-status-tones.ts`), duplicated
 * rather than imported: a cross-feature reach into `pages/orders` for one
 * lookup table isn't worth the coupling, and each module owns its own
 * status → tone map by convention here (`StatusBadge` itself carries no
 * domain knowledge). `status` can be `null` (the order was deleted since the
 * mention was made) or, in principle, a value this build doesn't know about —
 * both fall back to "neutral" instead of throwing.
 */
const ORDER_REF_STATUS_TONE: Readonly<Record<string, BadgeTone>> = {
  new: "neutral",
  confirming: "warning",
  processing: "warning",
  incomplete: "destructive",
  ready: "neutral",
  shipped: "neutral",
  delivered: "success",
  completed: "success",
  postponed: "warning",
  cancelled: "destructive",
  returned: "destructive",
  exchanged: "warning",
};

export function orderRefStatusTone(status: string | null): BadgeTone {
  if (status === null) return "neutral";
  return ORDER_REF_STATUS_TONE[status] ?? "neutral";
}
