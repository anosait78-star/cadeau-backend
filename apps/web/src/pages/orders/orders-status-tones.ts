import type { BadgeTone } from "@/components/status-badge/status-badge";
import type { OrderStatus } from "@/features/orders/orders-api";

/**
 * Orders' status → tone map (the shared `StatusBadge` is generic and carries
 * no domain knowledge by design — this is the module the component's own
 * docs point to). Only the tones `StatusBadge` already defines are used, per
 * the design system's "no foreign accent color" rule.
 *
 * Note: `StatusBadge`'s "info" tone renders as `bg-primary/15 text-primary`
 * (the shared component aliases it to the brand red, not the blue `--info`
 * token) — using it here would make "new" orders look the same red as a
 * cancelled/destructive one, so it's avoided in this map in favor of
 * "neutral" for the non-terminal, non-warning states.
 */
export const ORDER_STATUS_TONE: Readonly<Record<OrderStatus, BadgeTone>> = {
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
