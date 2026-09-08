import type { ReactNode } from "react";
import type { Translate } from "@/components/i18n/translate-type";
import { ProductThumb } from "@/components/product-thumb/product-thumb";
import { StatusBadge } from "@/components/status-badge/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StatusDropTarget, VendorDragProps } from "@/features/vendor/use-vendor-status-drag";
import {
  VENDOR_GROUP_STATUSES,
  type VendorGroup,
  type VendorGroupStatus,
} from "@/features/vendor/vendor-api";
import { VENDOR_GROUP_STATUS_TONE } from "@/features/vendor/vendor-group-status-tones";
import type { TranslationKey } from "@/i18n/dictionaries";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format-money";
import { vendorGroupTotal } from "./vendor-orders-columns";

/** The column header's accent colors, keyed by the same tone the status badge uses. */
const COLUMN_ACCENT: Readonly<Record<VendorGroupStatus, string>> = {
  new: "before:bg-muted-foreground/40",
  processing: "before:bg-warning",
  ready: "before:bg-primary",
  delivered: "before:bg-success",
};

/**
 * The vendor's desktop orders board (Vendor Accounts, Phase 7): one card per
 * status, laid out side by side, each holding the orders currently in that
 * status. Replaces a flat grid + filter-tab row with a real kanban read —
 * every status is visible at once, so "how much is stuck in processing" is
 * answered by looking, not by switching tabs.
 *
 * A column is also a drop target: dragging an order card onto a later
 * column's body moves it there, exactly as dropping on the old status tabs
 * did — {@link StatusDropTarget} is unchanged, only what renders it is new.
 */
export function VendorOrdersBoard({
  groups,
  draggingId,
  dragProps,
  dropTarget,
  onOpen,
  t,
  locale,
}: {
  readonly groups: readonly VendorGroup[];
  readonly draggingId: string | null;
  readonly dragProps: (group: VendorGroup) => VendorDragProps;
  readonly dropTarget: (status: VendorGroupStatus) => StatusDropTarget;
  readonly onOpen: (group: VendorGroup) => void;
  readonly t: Translate;
  readonly locale: string;
}): ReactNode {
  const byStatus: Record<VendorGroupStatus, VendorGroup[]> = {
    new: [],
    processing: [],
    ready: [],
    delivered: [],
  };
  for (const group of groups) byStatus[group.status].push(group);

  return (
    <div className="grid grid-cols-4 items-start gap-4">
      {VENDOR_GROUP_STATUSES.map((status) => (
        <VendorStatusColumn
          key={status}
          status={status}
          groups={byStatus[status]}
          draggingId={draggingId}
          dragProps={dragProps}
          drop={dropTarget(status)}
          onOpen={onOpen}
          t={t}
          locale={locale}
        />
      ))}
    </div>
  );
}

function VendorStatusColumn({
  status,
  groups,
  draggingId,
  dragProps,
  drop,
  onOpen,
  t,
  locale,
}: {
  readonly status: VendorGroupStatus;
  readonly groups: readonly VendorGroup[];
  readonly draggingId: string | null;
  readonly dragProps: (group: VendorGroup) => VendorDragProps;
  readonly drop: StatusDropTarget;
  readonly onOpen: (group: VendorGroup) => void;
  readonly t: Translate;
  readonly locale: string;
}): ReactNode {
  return (
    <Card
      {...drop.handlers}
      role="group"
      aria-label={t(`vendor.group.status.${status}` as TranslationKey)}
      title={drop.droppable ? t("vendor.orders.dropHere") : undefined}
      className={cn(
        "relative flex min-h-40 flex-col gap-0 overflow-hidden py-0 shadow-none",
        "before:absolute before:inset-x-0 before:top-0 before:h-1",
        COLUMN_ACCENT[status],
        drop.droppable && "ring-2 ring-primary/40 ring-offset-1 ring-offset-background",
        drop.active && "scale-[1.01] bg-primary/5 shadow-md ring-primary",
      )}
    >
      <CardHeader className="gap-0 border-b border-border bg-muted/30 p-3.5">
        <CardTitle className="flex items-center justify-between gap-2 text-sm font-semibold">
          <span className="truncate">{t(`vendor.group.status.${status}` as TranslationKey)}</span>
          <span
            className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground"
            dir="ltr"
          >
            {groups.length}
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-2 p-2.5">
        {groups.length === 0 ? (
          <p className="px-1.5 py-4 text-center text-caption text-muted-foreground">
            {t("vendor.orders.board.empty")}
          </p>
        ) : (
          groups.map((group) => (
            <VendorBoardOrderCard
              key={group.id}
              group={group}
              dragging={draggingId === group.id}
              // Every card is itself `draggable`, which — being a nested
              // draggable element — intercepts dragenter/dragover/drop before
              // they reach the column's own handlers, so dropping directly on
              // top of another order (rather than on empty column space)
              // silently did nothing. Taking cards out of hit-testing for the
              // duration of any drag lets those events fall straight through
              // to the column, which is the only thing that needs to see them.
              dragActive={draggingId !== null}
              dragProps={dragProps(group)}
              onOpen={() => onOpen(group)}
              t={t}
              locale={locale}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function VendorBoardOrderCard({
  group,
  dragging,
  dragActive,
  dragProps,
  onOpen,
  t,
  locale,
}: {
  readonly group: VendorGroup;
  readonly dragging: boolean;
  /** True while any card on the board is being dragged, this one included. */
  readonly dragActive: boolean;
  readonly dragProps: VendorDragProps;
  readonly onOpen: () => void;
  readonly t: Translate;
  readonly locale: string;
}): ReactNode {
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
        // Out of hit-testing while a card OTHER than this one is being
        // dragged, so drop events on top of it fall through to the column's
        // own drop handler instead of dead-ending on this (also-draggable)
        // element. Never applied to the card actually being dragged — Chrome
        // and Firefox both cancel an in-progress HTML5 drag the moment the
        // source element's own `pointer-events` changes mid-gesture, which is
        // exactly what silently killed every drag once this class covered it
        // too.
        dragActive && !dragging && "pointer-events-none",
      )}
    >
      <div className="flex items-center gap-2">
        <ProductThumb imageUrl={group.items[0]?.imageUrl ?? null} size="sm" />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground" dir="ltr">
            #{group.orderNumber}
          </span>
          <span className="block truncate text-caption text-muted-foreground">
            {group.items.length} {t("orders.field.items")}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <StatusBadge
          tone={VENDOR_GROUP_STATUS_TONE[group.status]}
          label={t(`vendor.group.status.${group.status}` as TranslationKey)}
        />
        <span className="shrink-0 text-sm font-semibold tabular-nums" dir="ltr">
          {formatMoney(vendorGroupTotal(group), locale)}
        </span>
      </div>
    </div>
  );
}
