import { MoreHorizontal } from "lucide-react";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import type { Translate } from "@/components/i18n/translate-type";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
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
import { TRANSITIONS } from "./orders-row-actions";
import { isWhatsappStatus } from "./orders-whatsapp";

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
 * Grab the board's background and drag it sideways.
 *
 * The wheel is deliberately left alone: it scrolls the page up and down as it
 * does everywhere else. An earlier attempt turned wheel-down into sideways
 * motion, which took the page's own scrolling away from the user — dragging
 * is what they actually wanted, and the two do not need to overlap.
 *
 * A pan must never start on a card. Cards are HTML5-draggable, and swallowing
 * their pointerdown would break dragging an order between columns, which is
 * the board's whole point — so a pan only begins on board or column
 * background, and buttons and inputs keep their own behaviour too.
 *
 * `scrollLeft = start - dx` is correct in BOTH writing directions: in RTL
 * `scrollLeft` simply runs 0 → -max, so pulling the content right (dx > 0)
 * drives it further negative exactly as it drives it positive in LTR
 * (verified in a browser, not assumed).
 */
function useDragToPan(): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;

    let panFrom: { readonly x: number; readonly scroll: number } | null = null;

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || event.pointerType !== "mouse") return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[draggable="true"], button, a, input, select, textarea') !== null) {
        return;
      }
      panFrom = { x: event.clientX, scroll: el.scrollLeft };
      el.setPointerCapture(event.pointerId);
      el.style.cursor = "grabbing";
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (panFrom === null) return;
      event.preventDefault();
      el.scrollLeft = panFrom.scroll - (event.clientX - panFrom.x);
    };

    const endPan = (event: PointerEvent): void => {
      if (panFrom === null) return;
      panFrom = null;
      el.style.cursor = "";
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endPan);
    el.addEventListener("pointercancel", endPan);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endPan);
      el.removeEventListener("pointercancel", endPan);
    };
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
  onSendWhatsapp,
  sendingWhatsappId,
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
  readonly onSendWhatsapp: (order: OrderListItem) => void;
  /** The order whose WhatsApp lookup is in flight, if any. */
  readonly sendingWhatsappId: string | null;
  readonly t: Translate;
  readonly locale: string;
}): ReactNode {
  const scrollRef = useDragToPan();
  const byStatus = {} as Record<OrderStatus, OrderListItem[]>;
  for (const status of ORDER_STATUSES) byStatus[status] = [];
  for (const order of orders) byStatus[order.status].push(order);

  return (
    // `items-start` keeps a short column from stretching to the tallest one.
    // The horizontal scroll is the whole point at twelve columns; `-mx-1 px-1`
    // stops a column's focus ring from being clipped by the scroll container.
    <div
      ref={scrollRef}
      className="-mx-1 flex cursor-grab items-start gap-4 overflow-x-auto px-1 pb-2"
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
          onSendWhatsapp={onSendWhatsapp}
          sendingWhatsappId={sendingWhatsappId}
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
  onSendWhatsapp,
  sendingWhatsappId,
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
  readonly onSendWhatsapp: (order: OrderListItem) => void;
  /** The order whose WhatsApp lookup is in flight, if any. */
  readonly sendingWhatsappId: string | null;
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
              onSendWhatsapp={() => onSendWhatsapp(order)}
              sendingWhatsapp={sendingWhatsappId === order.id}
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
  onSendWhatsapp,
  sendingWhatsapp,
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
  readonly onSendWhatsapp: () => void;
  readonly sendingWhatsapp: boolean;
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
        "flex cursor-pointer flex-col gap-1 rounded-lg border border-border bg-card p-2 shadow-xs",
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
      {/* Two rows, not three. The status badge that used to sit here is gone:
          the card lives inside its status column, so repeating the status on
          the card spent a whole row restating what the column already says —
          which is what made these cards so tall. */}
      <div className="flex items-center gap-1.5">
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
        {/* The customer is what staff scan a board for, so it is the card's
            headline — the order number, previously bold here, is a lookup key
            and drops to the caption row below. */}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {order.customerName}
        </span>
        {/* The per-order WhatsApp nudge. It lived in the data grid's row
            actions and was lost when the board replaced the grid (found
            2026-09-13) — the mobile list kept its own all along, so this was
            desktop-only breakage. Same three statuses as ever
            (`WHATSAPP_STATUSES`): confirming, ready, shipped. */}
        {isWhatsappStatus(order.status) ? (
          <span
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="presentation"
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-full bg-[#25D366] text-white hover:bg-[#1ebe57] hover:text-white"
              title={t("orders.whatsapp.rowButtonLabel")}
              aria-label={t("orders.whatsapp.rowButtonLabel")}
              disabled={sendingWhatsapp}
              onClick={() => onSendWhatsapp()}
            >
              {sendingWhatsapp ? (
                <Spinner className="h-3.5 w-3.5 text-white" />
              ) : (
                <WhatsAppIcon className="h-3.5 w-3.5" />
              )}
            </Button>
          </span>
        ) : null}
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
                  className="h-6 w-6"
                  // Per-order, not a bare "Change status": twenty identical
                  // buttons are useless to a screen reader (and ambiguous to
                  // the bulk bar's own button of that name).
                  aria-label={t("orders.board.changeStatusFor", { order: order.orderNumber })}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
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
      <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
        <span className="shrink-0 tabular-nums" dir="ltr">
          #{order.orderNumber}
        </span>
        <span className="truncate">
          {order.itemCount} {t("orders.field.items")}
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground" dir="ltr">
          {formatMoney(order.total, locale)}
        </span>
      </div>
    </div>
  );
}
