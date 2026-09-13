import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
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

/**
 * Each column's own color, as the CSS variable that carries it. Defined in
 * `globals.css` for both themes — a deliberate, board-only exception to the
 * design system's "no foreign accent color" rule (2026-09-13), because five
 * semantic tones cannot tell twelve columns apart. Status badges are
 * unaffected and still use those five tones.
 */
const STATUS_COLOR: Readonly<Record<OrderStatus, string>> = {
  new: "var(--status-new)",
  confirming: "var(--status-confirming)",
  processing: "var(--status-processing)",
  incomplete: "var(--status-incomplete)",
  ready: "var(--status-ready)",
  shipped: "var(--status-shipped)",
  delivered: "var(--status-delivered)",
  completed: "var(--status-completed)",
  postponed: "var(--status-postponed)",
  cancelled: "var(--status-cancelled)",
  returned: "var(--status-returned)",
  exchanged: "var(--status-exchanged)",
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
 * How far a wheel event should move a horizontal strip, or `null` to leave the
 * event alone.
 *
 * `null` for a trackpad's own sideways swipe, which already scrolls the strip
 * correctly and must not be doubled.
 *
 * The sign is the part worth pinning down: `scrollLeft` runs 0 → +max in LTR
 * but 0 → -max in RTL (verified in a browser, not assumed), so an Arabic board
 * needs the delta flipped. Without it the wheel is dead in one direction and
 * backwards in the other.
 */
export function horizontalWheelDelta({
  deltaX,
  deltaY,
  rtl,
}: {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly rtl: boolean;
}): number | null {
  if (Math.abs(deltaY) <= Math.abs(deltaX)) return null;
  return rtl ? -deltaY : deltaY;
}

/**
 * Let a plain mouse wheel scroll a horizontal strip.
 *
 * A wheel without a horizontal axis only ever emits `deltaY`, so the twelve
 * columns could be reached by dragging the scrollbar or holding Shift and
 * nothing else — a trackpad worked, a mouse did not.
 *
 * Three details this gets right:
 *
 * - The listener is attached natively with `passive: false`. React's own
 *   `onWheel` is registered passive, so `preventDefault` inside it is ignored
 *   and the page scrolls underneath anyway.
 * - `scrollLeft` runs 0 → -max in RTL and 0 → +max in LTR (verified in the
 *   browser, not assumed), so the delta is flipped for Arabic. Without this
 *   the wheel would be dead in one direction and inverted in the other.
 * - The page is only prevented from scrolling when the strip actually moved.
 *   At either end the event falls through, so reaching the last column does
 *   not trap the wheel and leave the page stuck.
 */
function useWheelToHorizontalScroll(): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const onWheel = (event: WheelEvent): void => {
      if (el.scrollWidth <= el.clientWidth) return;
      const delta = horizontalWheelDelta({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        rtl: getComputedStyle(el).direction === "rtl",
      });
      if (delta === null) return;
      const before = el.scrollLeft;
      el.scrollLeft = before + delta;
      if (el.scrollLeft !== before) event.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return ref;
}

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
  const scrollRef = useWheelToHorizontalScroll();
  const byStatus = {} as Record<OrderStatus, OrderListItem[]>;
  for (const status of ORDER_STATUSES) byStatus[status] = [];
  for (const order of orders) byStatus[order.status].push(order);

  return (
    // `items-start` keeps a short column from stretching to the tallest one.
    // The horizontal scroll is the whole point at twelve columns; `-mx-1 px-1`
    // stops a column's focus ring from being clipped by the scroll container.
    <div
      ref={scrollRef}
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
      // Set inline because the value differs per column: `--status-color`
      // feeds the top stripe (a pseudo-element, so it cannot be styled
      // inline — see `.orders-board-column::before`), and the same color
      // tints the body. The inline `backgroundColor` also wins over `Card`'s
      // own `bg-card`, which a custom class would not reliably do.
      style={
        {
          "--status-color": STATUS_COLOR[status],
          backgroundColor: `color-mix(in srgb, ${STATUS_COLOR[status]} var(--status-tint), transparent)`,
        } as CSSProperties
      }
      className={cn(
        "orders-board-column",
        "relative flex w-72 shrink-0 flex-col gap-0 overflow-hidden py-0 shadow-none",
        "before:absolute before:inset-x-0 before:top-0 before:h-1",
        drop.droppable && "ring-2 ring-primary/40 ring-offset-1 ring-offset-background",
        drop.active && "shadow-md ring-primary",
      )}
    >
      {/* No `bg-muted/30` here any more: a gray wash over the tint turned
          every column the same muddy color, which is the opposite of the
          point. The border alone separates the header. */}
      <CardHeader className="gap-0 border-b border-border p-3.5">
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
