import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import type { Translate } from "@/components/i18n/translate-type";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ORDER_STATUSES, type OrderListItem, type OrderStatus } from "@/features/orders/orders-api";
import type { StatusDragProps, StatusDropTarget } from "@/hooks/use-status-drag";
import type { TranslationKey } from "@/i18n/dictionaries";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format-money";
import { StatusBadge } from "./orders-columns";
import { TRANSITIONS } from "./orders-row-actions";
import type { BadgeTone } from "@/components/status-badge/status-badge";
import { ORDER_STATUS_TONE } from "./orders-status-tones";

/**
 * The column header's accent stripe, derived from the status's badge tone so
 * a column and the badges inside it can never disagree about what a status
 * "looks like" — and so a new status only has to be classified once.
 */
const TONE_ACCENT: Readonly<Record<BadgeTone, string>> = {
  neutral: "before:bg-muted-foreground/40",
  info: "before:bg-primary",
  warning: "before:bg-warning",
  success: "before:bg-success",
  destructive: "before:bg-destructive",
};

/**
 * Column order, which is deliberately NOT `ORDER_STATUSES`.
 *
 * That constant is lifecycle order and stays untouched — the phone's tab
 * strip, the bulk dropdown and the transition graph all read it. The board is
 * a work surface, and `incomplete` is not a step on the way to anywhere: it is
 * where an order parks when something is missing. Sitting fourth, between
 * `processing` and `ready`, it split the run of columns staff actually move
 * cards along. Parked at the end it stops interrupting that flow while staying
 * one drop away (requested 2026-09-13).
 */
const BOARD_COLUMNS: readonly OrderStatus[] = [
  ...ORDER_STATUSES.filter((s) => s !== "incomplete"),
  "incomplete",
];

/**
 * The company's desktop orders board: one column per lifecycle status, with
 * orders dragged between them. It replaces the status tab strip + data grid,
 * which showed one status at a time and — more to the point — offered no way
 * at all to change a single order's status (the row menu's `onTransition` was
 * wired but never rendered, and the detail drawer only ever showed a badge).
 *
 * Unlike the vendor board this one has **twelve** columns, so it scrolls
 * sideways rather than dividing the width twelve ways; each column keeps a
 * readable fixed width instead.
 *
 * Two rules differ from the vendor board and live in the page, not here:
 * a drop is legal only per the full transition graph (not merely "forward"),
 * and a drop onto `cancelled` opens the reason modal instead of firing the
 * request — the server rejects a cancel with no reason.
 */
export function OrdersBoard({
  orders,
  counts,
  draggingId,
  dragProps,
  dropTarget,
  onOpen,
  hasMore,
  onLoadMore,
  loadingMore,
  selectedIds,
  onToggleSelect,
  onChangeStatus,
  canManage,
  t,
  locale,
}: {
  readonly orders: readonly OrderListItem[];
  /** Live per-status totals from the counts endpoint — not the loaded length. */
  readonly counts: Readonly<Record<string, number>>;
  readonly draggingId: string | null;
  readonly dragProps: (order: OrderListItem) => StatusDragProps;
  readonly dropTarget: (status: OrderStatus) => StatusDropTarget;
  readonly onOpen: (order: OrderListItem) => void;
  readonly hasMore: (status: OrderStatus) => boolean;
  readonly onLoadMore: (status: OrderStatus) => void;
  readonly loadingMore: OrderStatus | null;
  readonly selectedIds: ReadonlySet<string>;
  readonly onToggleSelect: (id: string) => void;
  readonly onChangeStatus: (order: OrderListItem, to: OrderStatus) => void;
  /** Whether the caller holds `orders.manage` — gates dragging AND the menu. */
  readonly canManage: boolean;
  readonly t: Translate;
  readonly locale: string;
}): ReactNode {
  const byStatus = {} as Record<OrderStatus, OrderListItem[]>;
  for (const status of ORDER_STATUSES) byStatus[status] = [];
  for (const order of orders) byStatus[order.status].push(order);

  return (
    // `items-start` keeps a short column from stretching to the tallest one.
    // The horizontal scroll is the whole point at twelve columns; `-mx-1 px-1`
    // stops a column's focus ring from being clipped by the scroll container.
    <div
      className="-mx-1 flex items-start gap-4 overflow-x-auto px-1 pb-2"
      role="list"
      aria-label={t("orders.board.label")}
    >
      {BOARD_COLUMNS.map((status) => (
        <OrderStatusColumn
          key={status}
          status={status}
          orders={byStatus[status]}
          count={counts[status] ?? byStatus[status].length}
          draggingId={draggingId}
          dragProps={dragProps}
          drop={dropTarget(status)}
          onOpen={onOpen}
          hasMore={hasMore(status)}
          onLoadMore={() => onLoadMore(status)}
          loadingMore={loadingMore === status}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          onChangeStatus={onChangeStatus}
          canManage={canManage}
          t={t}
          locale={locale}
        />
      ))}
    </div>
  );
}

function OrderStatusColumn({
  status,
  orders,
  count,
  draggingId,
  dragProps,
  drop,
  onOpen,
  hasMore,
  onLoadMore,
  loadingMore,
  selectedIds,
  onToggleSelect,
  onChangeStatus,
  canManage,
  t,
  locale,
}: {
  readonly status: OrderStatus;
  readonly orders: readonly OrderListItem[];
  readonly count: number;
  readonly draggingId: string | null;
  readonly dragProps: (order: OrderListItem) => StatusDragProps;
  readonly drop: StatusDropTarget;
  readonly onOpen: (order: OrderListItem) => void;
  readonly hasMore: boolean;
  readonly onLoadMore: () => void;
  readonly loadingMore: boolean;
  readonly selectedIds: ReadonlySet<string>;
  readonly onToggleSelect: (id: string) => void;
  readonly onChangeStatus: (order: OrderListItem, to: OrderStatus) => void;
  /** Whether the caller holds `orders.manage` — gates dragging AND the menu. */
  readonly canManage: boolean;
  readonly t: Translate;
  readonly locale: string;
}): ReactNode {
  const label = t(`orders.status.${status}` as TranslationKey);
  return (
    <Card
      {...drop.handlers}
      role="listitem"
      aria-label={label}
      title={drop.droppable ? t("orders.board.dropHere") : undefined}
      className={cn(
        "relative flex w-72 shrink-0 flex-col gap-0 overflow-hidden py-0 shadow-none",
        "before:absolute before:inset-x-0 before:top-0 before:h-1",
        TONE_ACCENT[ORDER_STATUS_TONE[status]],
        drop.droppable && "ring-2 ring-primary/40 ring-offset-1 ring-offset-background",
        drop.active && "bg-primary/5 shadow-md ring-primary",
      )}
    >
      <CardHeader className="gap-0 border-b border-border bg-muted/30 p-3.5">
        <CardTitle className="flex items-center justify-between gap-2 text-sm font-semibold">
          <span className="truncate">{label}</span>
          <span
            className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground"
            dir="ltr"
          >
            {count}
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-2 p-2.5">
        {orders.length === 0 ? (
          <p className="px-1.5 py-4 text-center text-caption text-muted-foreground">
            {t("orders.board.empty")}
          </p>
        ) : (
          orders.map((order) => (
            <OrderBoardCard
              key={order.id}
              order={order}
              dragging={draggingId === order.id}
              dragActive={draggingId !== null}
              dragProps={dragProps(order)}
              selected={selectedIds.has(order.id)}
              onToggleSelect={() => onToggleSelect(order.id)}
              onChangeStatus={(to) => onChangeStatus(order, to)}
              canManage={canManage}
              onOpen={() => onOpen(order)}
              t={t}
              locale={locale}
            />
          ))
        )}
        {hasMore ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {t("orders.loadMore")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function OrderBoardCard({
  order,
  dragging,
  dragActive,
  dragProps,
  selected,
  onToggleSelect,
  onChangeStatus,
  canManage,
  onOpen,
  t,
  locale,
}: {
  readonly order: OrderListItem;
  readonly dragging: boolean;
  /** True while any card on the board is being dragged, this one included. */
  readonly dragActive: boolean;
  readonly dragProps: StatusDragProps;
  readonly selected: boolean;
  readonly onToggleSelect: () => void;
  readonly onChangeStatus: (to: OrderStatus) => void;
  readonly canManage: boolean;
  readonly onOpen: () => void;
  readonly t: Translate;
  readonly locale: string;
}): ReactNode {
  // Dragging is a pointer-only affordance, so the same transitions must be
  // reachable without one. These are exactly the drops the board would accept.
  const targets = canManage ? TRANSITIONS[order.status] : [];
  return (
    <div
      {...dragProps}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-card p-2.5 shadow-xs",
        "transition-all duration-[var(--motion-hover)] hover:border-primary/40 hover:shadow-sm",
        "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
        selected && "border-primary ring-1 ring-primary/40",
        // Out of hit-testing while a card OTHER than this one is being
        // dragged, so drop events on top of it fall through to the column's
        // own drop handler instead of dead-ending on this (also-draggable)
        // element. Never applied to the card actually being dragged — Chrome
        // and Firefox both cancel an in-progress HTML5 drag the moment the
        // source element's own `pointer-events` changes mid-gesture.
        dragActive && !dragging && "pointer-events-none",
      )}
    >
      <div className="flex items-center gap-2">
        {/* Selection survives the grid's removal: the bulk bar (assign, create
            shipment) is still driven by the same `useDataGridSelection`. The
            click must not also open the drawer. */}
        <span
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="presentation"
        >
          <Checkbox
            checked={selected}
            onChange={onToggleSelect}
            // Same label the grid used, so selection reads identically to
            // anyone (or any test) that knew the old table.
            aria-label="Select row"
          />
        </span>
        <span className="shrink-0 text-sm font-semibold text-foreground" dir="ltr">
          #{order.orderNumber}
        </span>
        <span className="ms-auto shrink-0 text-caption text-muted-foreground">
          {order.itemCount} {t("orders.field.items")}
        </span>
        {canManage && targets.length > 0 ? (
          <span
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="presentation"
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  // Per-order, not a bare "Change status": twenty identical
                  // buttons are useless to a screen reader (and ambiguous to
                  // the bulk bar's own button of that name).
                  aria-label={t("orders.board.changeStatusFor", { order: order.orderNumber })}
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{t("orders.board.changeStatus")}</DropdownMenuLabel>
                {targets.map((to) => (
                  <DropdownMenuItem key={to} onSelect={() => onChangeStatus(to)}>
                    {t(`orders.status.${to}` as TranslationKey)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        ) : null}
      </div>
      <span className="block truncate text-sm text-foreground">{order.customerName}</span>
      <div className="flex items-center justify-between gap-2">
        <StatusBadge
          status={order.status}
          label={t(`orders.status.${order.status}` as TranslationKey)}
        />
        <span className="shrink-0 text-sm font-semibold tabular-nums" dir="ltr">
          {formatMoney(order.total, locale)}
        </span>
      </div>
    </div>
  );
}
