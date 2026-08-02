import type { ReactNode } from "react";
import { PermissionGate } from "@/components/access/permission-gate";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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

/** The "..." row-actions dropdown: open details, transition status. */
export function OrderRowActions({
  order,
  t,
  onOpenDetail,
  onTransition,
  onCancelRequiresReason,
}: {
  order: OrderListItem;
  t: (key: TranslationKey) => string;
  onOpenDetail: (order: OrderListItem) => void;
  onTransition: (id: string, to: OrderStatus) => void | Promise<void>;
  onCancelRequiresReason: () => void;
}): ReactNode {
  const nextStates = TRANSITIONS[order.status];

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
        <PermissionGate permission="orders.manage">
          {nextStates.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              {nextStates.map((next) => (
                <DropdownMenuItem
                  key={next}
                  onSelect={() => {
                    if (next === "cancelled") {
                      onCancelRequiresReason();
                      return;
                    }
                    void onTransition(order.id, next);
                  }}
                >
                  {t(`orders.actions.transitionTo` as TranslationKey)}{" "}
                  {t(`orders.status.${next}` as TranslationKey)}
                </DropdownMenuItem>
              ))}
            </>
          ) : null}
        </PermissionGate>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
