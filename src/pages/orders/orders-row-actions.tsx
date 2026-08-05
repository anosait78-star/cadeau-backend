import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OrderListItem, OrderStatus } from "@/features/orders/orders-api";
import type { TranslationKey } from "@/i18n/dictionaries";

/** All valid next states per current state (mirrors the server state machine). */
export const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
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

/**
 * The "..." row-actions dropdown. Deliberately just "Details" — status
 * changes already have their own dedicated control once an order is open
 * (and in bulk via the selection toolbar), so this quick row menu doesn't
 * duplicate the full state machine. `onTransition`/`onCancelRequiresReason`
 * stay in the prop signature (unused here) so the call site in
 * `orders-page.tsx` doesn't need to change.
 */
export function OrderRowActions({
  order,
  t,
  onOpenDetail,
}: {
  order: OrderListItem;
  t: (key: TranslationKey) => string;
  onOpenDetail: (order: OrderListItem) => void;
  onTransition: (id: string, to: OrderStatus) => void | Promise<void>;
  onCancelRequiresReason: () => void;
}): ReactNode {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={t("orders.actions.rowMenu")}
        >
          ⋯
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onOpenDetail(order)}>
          {t("orders.actions.details")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
