import { Download, MoreHorizontal, Plus, Printer } from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { AuthContext } from "@/auth/auth-context";
import { FeatureGate } from "@/components/access/feature-gate";
import { PermissionGate } from "@/components/access/permission-gate";
import { BulkActionsBar } from "@/components/bulk-actions/bulk-actions-bar";
import { MobileCardList } from "@/components/data-grid/mobile-card-list";
import { MobileListRow } from "@/components/data-grid/mobile-list-row";
import { useDataGridSelection } from "@/components/data-grid/use-data-grid-selection";
import { DetailPanel } from "@/components/detail-panel/detail-panel";
import type { Translate } from "@/components/i18n/translate-type";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { useToast } from "@/components/toast/toast";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FormField } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { listItems as listMasterDataItems } from "@/features/master-data/master-data-api";
import {
  bulkAssign,
  bulkStatus,
  createOrder,
  listOrders,
  orderStatusCounts,
  ORDER_STATUSES,
  transitionOrder,
  type CreateOrderInput,
  type ListOptions,
  type OrderDetail,
  type OrderListItem,
  type OrderStatus,
  type PaymentStatus,
} from "@/features/orders/orders-api";
import { SelectCarrierDialog } from "@/features/shipping/select-carrier-dialog";
import {
  useRegisterMobilePrimaryAction,
  useRegisterMobileRefresh,
} from "@/components/shell/mobile/mobile-header-context";
import { useCapabilities } from "@/features/access/use-capabilities";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useStatusDrag } from "@/hooks/use-status-drag";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format-money";
import { PaymentBadge, StatusBadge, type OrderLabel } from "./orders-columns";
import { OrderForm } from "./orders-create-form";
import {
  buildOrderDetailHeader,
  buildOrderDetailSections,
  useOrderDetailData,
} from "./orders-detail-sections";
import { downloadCsv, ordersToCsv } from "./orders-export";
import { OrdersBoard } from "./orders-board";
import { OrdersFilterBar } from "./orders-filter-bar";
import { TRANSITIONS } from "./orders-row-actions";
import { isWhatsappStatus, openWhatsappForOrder, type WhatsappStatus } from "./orders-whatsapp";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly items: OrderListItem[]; readonly nextCursor: string | null };

/**
 * Orders — the order lifecycle (EPIC-11), rebuilt on the generic DataGrid/
 * DetailPanel/BulkActions/TableToolbar infrastructure. The whole screen is
 * behind the `orders` feature; create/edit/status/assign are behind
 * `orders.manage` (the API re-checks both — ADR-003). Desktop renders a data
 * grid, mobile an independently-designed card list (ADR-002).
 */
/** Last-write-wins dedupe by `id`, preserving order. */
function dedupeById(orders: readonly OrderListItem[]): OrderListItem[] {
  return [...new Map(orders.map((o) => [o.id, o])).values()];
}

export function OrdersPage(): ReactNode {
  const { t } = useI18n();
  return (
    <FeatureGate
      feature="orders"
      fallback={
        <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
          <EmptyState title={t("orders.forbidden")} />
        </div>
      }
    >
      <OrdersScreen />
    </FeatureGate>
  );
}

function OrdersScreen(): ReactNode {
  const { t, locale } = useI18n();
  const isDesktop = useIsDesktop();
  const capabilities = useCapabilities();
  const [searchParams, setSearchParams] = useSearchParams();
  const auth = useContext(AuthContext);
  const currentUserId = auth?.user?.id ?? null;
  const companyId = auth?.user?.activeCompanyId ?? null;
  const companyName =
    auth?.user?.companies.find((c) => c.id === auth.user?.activeCompanyId)?.name ?? "";

  const [state, setState] = useState<State>({ kind: "loading" });
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [viewFilters, setViewFilters] = useState<ListOptions>({});
  const [paymentFilter, setPaymentFilter] = useState<PaymentStatus | "all">("all");
  const [creating, setCreating] = useState(false);

  // On mobile, "new order" is the shell's floating action button rather than a
  // toolbar button competing with the page title (ADR-002).
  useRegisterMobilePrimaryAction({
    label: t("orders.actions.create"),
    icon: Plus,
    onAction: () => setCreating(true),
    enabled: capabilities.has({ permission: "orders.manage" }),
  });
  // Pull down at the top of the list to reload it (Mobile shell).
  useRegisterMobileRefresh(() => load());

  // The installed app's "New order" shortcut launches straight into the create
  // form. The parameter is consumed on arrival so a reload does not reopen it.
  useEffect(() => {
    if (searchParams.get("new") === null) return;
    if (capabilities.has({ permission: "orders.manage" })) setCreating(true);
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, capabilities]);
  const [labelsById, setLabelsById] = useState<Map<string, OrderLabel>>(new Map());
  const [selectedOrder, setSelectedOrder] = useState<OrderListItem | null>(null);
  // Shipments are always created one order at a time (no bulk shipping) — set
  // when exactly one row is selected and "Create shipment" is clicked.
  const [shippingOrder, setShippingOrder] = useState<OrderListItem | null>(null);
  // The floating "send a WhatsApp message?" prompt, offered right after a
  // single order's status lands on one of WHATSAPP_STATUSES.
  const [waPrompt, setWaPrompt] = useState<OrderListItem | null>(null);
  // A cancellation always needs a reason (server-enforced) — this app never
  // had anywhere to pick one, so cancelling silently only ever failed
  // (confirmed live, 2026-09-07). Holds the order id(s) awaiting a reason;
  // `null` when the modal is closed.
  const [cancelling, setCancelling] = useState<string[] | null>(null);
  const [cancelReasonId, setCancelReasonId] = useState("");
  const [cancelReasons, setCancelReasons] = useState<{ id: string; name: string }[]>([]);
  const [cancelPending, setCancelPending] = useState(false);
  // The order id whose WhatsApp send is currently in flight (the customer
  // phone lookup) — drives the spinner + disables that one button so a slow
  // network can't be double-clicked into two tabs.
  const [sendingWhatsappId, setSendingWhatsappId] = useState<string | null>(null);

  const selection = useDataGridSelection();

  const toast = useToast();
  const flash = useCallback((text: string): void => toast.show(text), [toast]);

  const baseQuery = useCallback((): ListOptions => {
    // Date range always comes from `dateFrom`/`dateTo` state (the filter bar),
    // never from `viewFilters` (which only ever carries the Tags dropdown's
    // `labelId` now), so clearing the date inputs always clears the filter.
    const { createdAtFrom: _from, createdAtTo: _to, ...restFilters } = viewFilters;
    void _from;
    void _to;
    return {
      ...restFilters,
      ...(dateFrom.length > 0 ? { createdAtFrom: new Date(dateFrom).toISOString() } : {}),
      ...(dateTo.length > 0 ? { createdAtTo: new Date(`${dateTo}T23:59:59`).toISOString() } : {}),
      ...(status !== "all" ? { status } : {}),
      ...(search.trim().length > 0 ? { q: search.trim() } : {}),
      // Newest first in every column — the board has no sort control, and the
      // grid header that used to offer one is gone.
      sort: "-createdAt" as const,
    };
  }, [viewFilters, dateFrom, dateTo, status, search]);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    const query = baseQuery();
    try {
      const [page, tabs] = await Promise.all([listOrders(query), orderStatusCounts(query)]);
      setState({ kind: "ready", items: page.data, nextCursor: page.page.nextCursor });
      setCounts(tabs.counts);
    } catch {
      setState({ kind: "error" });
    }
  }, [baseQuery]);

  useEffect(() => {
    void listMasterDataItems("order-labels", { active: true })
      .then((page) =>
        setLabelsById(
          new Map(
            page.data.map((item) => [
              item.id,
              {
                id: item.id,
                name: String(item["name"] ?? ""),
                color: (item["color"] as string | null) ?? null,
              },
            ]),
          ),
        ),
      )
      .catch(() => setLabelsById(new Map()));
  }, []);

  const selectStatus = (next: OrderStatus | "all"): void => {
    setStatus(next);
  };

  const resetFilters = (): void => {
    setSearch("");
    setStatus("all");
    setDateFrom("");
    setDateTo("");
    setPaymentFilter("all");
    setViewFilters({});
    selection.clear();
  };

  const loadMore = async (): Promise<void> => {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    const page = await listOrders({ ...baseQuery(), cursor: state.nextCursor });
    setState({
      kind: "ready",
      items: [...state.items, ...page.data],
      nextCursor: page.page.nextCursor,
    });
  };

  const patchRow = (order: OrderDetail): void => {
    setState((s) =>
      s.kind === "ready"
        ? { ...s, items: s.items.map((i) => (i.id === order.id ? toListItem(order) : i)) }
        : s,
    );
  };

  const onCreate = async (body: CreateOrderInput): Promise<void> => {
    try {
      const created = await createOrder(body);
      setState((s) =>
        s.kind === "ready" ? { ...s, items: [toListItem(created), ...s.items] } : s,
      );
      setCreating(false);
      flash(t("orders.saved"));
      void reload();
    } catch (error) {
      flash(saveErrorText(error, t));
    }
  };

  const refreshCounts = useCallback(async (): Promise<void> => {
    try {
      const tabs = await orderStatusCounts(status !== "all" ? { status } : {});
      setCounts(tabs.counts);
    } catch {
      /* counts are best-effort */
    }
  }, [status]);

  // ---- board (desktop) ----------------------------------------------------
  // The board shows every status at once, so it cannot reuse the single
  // keyset list: paging one combined list would leave columns arbitrarily
  // incomplete. Instead each column is its own small first page, and the
  // twelve are fetched in parallel. They land in the SAME `state.items` the
  // grid uses, bucketed by status at render time — which is what makes an
  // optimistic move a one-field patch rather than a splice between arrays.
  const BOARD_PAGE_SIZE = "20";
  const [boardCursors, setBoardCursors] = useState<Partial<Record<OrderStatus, string | null>>>({});
  const [loadingColumn, setLoadingColumn] = useState<OrderStatus | null>(null);
  const [announcement, setAnnouncement] = useState("");

  /** `baseQuery` minus `status` — the board is never filtered to one status. */
  const boardQuery = useCallback((): ListOptions => {
    const { status: _status, ...rest } = baseQuery();
    void _status;
    return rest;
  }, [baseQuery]);

  const loadBoard = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    const query = boardQuery();
    try {
      const [tabs, ...pages] = await Promise.all([
        orderStatusCounts(query),
        ...ORDER_STATUSES.map((s) => listOrders({ ...query, status: s, limit: BOARD_PAGE_SIZE })),
      ]);
      const cursors: Partial<Record<OrderStatus, string | null>> = {};
      ORDER_STATUSES.forEach((s, i) => {
        cursors[s] = pages[i]?.page.nextCursor ?? null;
      });
      setState({
        kind: "ready",
        // Deduped by id: the twelve column fetches are concurrent, so an order
        // whose status changes mid-flight can legitimately come back in two of
        // them. Without this it would render twice, under two different
        // columns, with the same React key.
        items: dedupeById(pages.flatMap((page) => page.data)),
        nextCursor: null,
      });
      setBoardCursors(cursors);
      setCounts(tabs.counts);
    } catch {
      setState({ kind: "error" });
    }
  }, [boardQuery]);

  /** Reload whichever view is on screen — the board on desktop, the list on a phone. */
  const reload = useCallback(
    (): Promise<void> => (isDesktop ? loadBoard() : load()),
    [isDesktop, loadBoard, load],
  );

  const loadMoreColumn = async (column: OrderStatus): Promise<void> => {
    const cursor = boardCursors[column];
    if (cursor === null || cursor === undefined) return;
    setLoadingColumn(column);
    try {
      const page = await listOrders({
        ...boardQuery(),
        status: column,
        limit: BOARD_PAGE_SIZE,
        cursor,
      });
      setState((s) =>
        s.kind === "ready" ? { ...s, items: dedupeById([...s.items, ...page.data]) } : s,
      );
      setBoardCursors((c) => ({ ...c, [column]: page.page.nextCursor }));
    } catch {
      /* leaving the column as it was is the right failure here — the button stays. */
    } finally {
      setLoadingColumn(null);
    }
  };

  const patchStatus = (id: string, to: OrderStatus): void => {
    setState((s) =>
      s.kind === "ready"
        ? { ...s, items: s.items.map((i) => (i.id === id ? { ...i, status: to } : i)) }
        : s,
    );
  };

  /**
   * Apply a dropped move optimistically, rolling back to the exact status the
   * card started in if the server refuses. The refusal is worth showing in
   * full rather than as a generic failure: entering `processing` reserves
   * stock and comes back as a shortage the user can actually act on.
   */
  const moveOrder = (order: OrderListItem, to: OrderStatus): void => {
    const before = order.status;
    patchStatus(order.id, to);
    void transitionOrder(order.id, { toStatus: to })
      .then((updated) => {
        patchRow(updated);
        setAnnouncement(
          t("orders.board.moved", {
            order: order.orderNumber,
            status: t(`orders.status.${to}` as TranslationKey),
          }),
        );
        void refreshCounts();
        if (isWhatsappStatus(to)) setWaPrompt(toListItem(updated));
      })
      .catch((error: unknown) => {
        patchStatus(order.id, before);
        setAnnouncement(t("orders.board.moveFailed"));
        flash(saveErrorText(error, t));
      });
  };

  const canManageOrders = capabilities.has({ permission: "orders.manage" });

  const { draggingId, dragProps, dropTarget } = useStatusDrag<OrderListItem, OrderStatus>({
    dragType: "application/x-cadeau-order",
    // The client mirror of the server's state machine. A column that isn't a
    // legal destination stays inert rather than accepting the drop and then
    // reporting a 422 the user could not have predicted.
    canDrop: (order, to) => canManageOrders && TRANSITIONS[order.status].includes(to),
    onMove: (order, to) => {
      // Cancelling is the one transition the server refuses without a reason,
      // so a drop onto this column opens the picker instead of firing. The
      // optimistic patch is deliberately skipped until the modal confirms —
      // showing the card as cancelled and then snapping it back if the user
      // backs out would be worse than waiting.
      if (to === "cancelled") {
        setCancelling([order.id]);
        return;
      }
      moveOrder(order, to);
    },
  });

  // Declared after `reload` on purpose: it is a `const`, so an effect placed
  // above it would hit the temporal dead zone on first render.
  useEffect(() => {
    void reload();
  }, [reload]);

  const onBulkStatus = async (toStatus: OrderStatus): Promise<void> => {
    if (toStatus === "cancelled") {
      setCancelling([...selection.selectedIds]);
      return;
    }
    // The WhatsApp prompt only ever targets one order — capture it (if the
    // selection is exactly one row) before `selection.clear()` wipes it.
    const promptCandidate =
      state.kind === "ready" && selection.selectedIds.size === 1
        ? (state.items.find((o) => o.id === [...selection.selectedIds][0]) ?? null)
        : null;
    try {
      const { results } = await bulkStatus([...selection.selectedIds], toStatus);
      const failed = results.filter((r) => !r.ok);
      selection.clear();
      flash(failed.length > 0 ? t("orders.saveFailed") : t("orders.saved"));
      void reload();
      if (promptCandidate !== null && failed.length === 0 && isWhatsappStatus(toStatus)) {
        setWaPrompt({ ...promptCandidate, status: toStatus });
      }
    } catch (error) {
      flash(saveErrorText(error, t));
    }
  };

  // Reasons load once, the first time the cancel modal opens (mirrors
  // `ReasonsPanel`'s own fetch) — not on every mount, since most sessions
  // never cancel an order.
  useEffect(() => {
    if (cancelling === null || cancelReasons.length > 0) return;
    void listMasterDataItems("order-reasons", { active: true, filters: { kind: "cancellation" } })
      .then((page) => {
        setCancelReasons(
          page.data.map((item) => ({ id: item.id, name: String(item["name"] ?? "") })),
        );
      })
      .catch(() => {
        /* the Combobox just stays empty; the confirm button is still usable via retry */
      });
  }, [cancelling, cancelReasons.length]);

  const confirmCancel = async (): Promise<void> => {
    if (cancelling === null || cancelReasonId === "") return;
    setCancelPending(true);
    try {
      const { results } = await bulkStatus(cancelling, "cancelled", cancelReasonId);
      const failed = results.filter((r) => !r.ok);
      selection.clear();
      setCancelling(null);
      setCancelReasonId("");
      flash(failed.length > 0 ? t("orders.saveFailed") : t("orders.saved"));
      void reload();
      void refreshCounts();
    } catch (error) {
      flash(saveErrorText(error, t));
    } finally {
      setCancelPending(false);
    }
  };

  const onBulkAssign = async (): Promise<void> => {
    if (currentUserId === null) return;
    try {
      const { results } = await bulkAssign([...selection.selectedIds], currentUserId);
      const failed = results.filter((r) => !r.ok);
      selection.clear();
      flash(failed.length > 0 ? t("orders.saveFailed") : t("orders.saved"));
      void reload();
    } catch (error) {
      flash(saveErrorText(error, t));
    }
  };

  const onExport = (): void => {
    if (state.kind !== "ready") return;
    downloadCsv(ordersToCsv(state.items), `orders-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const sendWhatsapp = async (
    order: Pick<OrderListItem, "id" | "customerId" | "customerName" | "orderNumber">,
    orderStatus: WhatsappStatus,
  ): Promise<void> => {
    if (sendingWhatsappId !== null) return; // one send in flight at a time
    setSendingWhatsappId(order.id);
    try {
      await openWhatsappForOrder(order, orderStatus, companyName, t, flash);
    } finally {
      setSendingWhatsappId(null);
    }
  };

  const detailData = useOrderDetailData(selectedOrder?.id ?? null);
  const detailSections =
    detailData.detail !== null
      ? buildOrderDetailSections({
          detail: detailData.detail,
          activity: detailData.activity,
          vendorGroups: detailData.vendorGroups,
          vendorAggregateStatus: detailData.vendorAggregateStatus,
          t,
          locale,
          companyId,
          onNotify: flash,
          onPatch: (order) => {
            patchRow(order);
            detailData.setDetail(order);
          },
          // Undefined for anyone without the override permission — that is
          // what keeps the per-vendor status control off the tracking tab.
          onVendorGroupUpdated: capabilities.has({ permission: "orders.vendor_groups.override" })
            ? detailData.patchVendorGroup
            : undefined,
        })
      : [];

  // Presentation-only drawer header (status chip, customer + date, total),
  // built from the order that is already loaded — no extra fetch.
  const detailHeader =
    detailData.detail !== null
      ? buildOrderDetailHeader({ detail: detailData.detail, locale, t })
      : null;

  const visibleRows = useMemo(() => {
    if (state.kind !== "ready") return [];
    if (paymentFilter === "all") return state.items;
    return state.items.filter((o) => o.paymentStatus === paymentFilter);
  }, [state, paymentFilter]);

  const totalCount = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts]);

  const bulkStatusTargets = useMemo(() => {
    if (state.kind !== "ready") return [];
    const selectedOrders = state.items.filter((o) => selection.selectedIds.has(o.id));
    if (selectedOrders.length === 0) return [];
    return ORDER_STATUSES.filter((s) =>
      selectedOrders.every((o) => TRANSITIONS[o.status].includes(s)),
    );
  }, [state, selection.selectedIds]);

  // Shipments are one-order-at-a-time by design — the "Create shipment" bulk
  // action is only offered when exactly one row is checked.
  const singleSelectedOrder = useMemo(() => {
    if (state.kind !== "ready" || selection.selectedIds.size !== 1) return null;
    const [id] = selection.selectedIds;
    return state.items.find((o) => o.id === id) ?? null;
  }, [state, selection.selectedIds]);

  return (
    // The page gutter on mobile belongs to the shell (`.mobile-main`); adding
    // one here too would double it.
    <div className="mx-auto flex w-full max-w-[100rem] flex-col gap-6 lg:p-6">
      {/* Header: actions at the start, title/subtitle at the end (matches the app's RTL reading order).
          On mobile the shell owns the title and the FAB owns "create", so only
          the secondary actions remain. */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {isDesktop ? (
            <PermissionGate permission="orders.manage">
              {creating ? null : (
                <Button onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {t("orders.actions.create")}
                </Button>
              )}
            </PermissionGate>
          ) : null}
          <Button variant="outline" onClick={onExport}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {t("orders.actions.export")}
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            {t("orders.actions.print")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t("orders.actions.more")}>
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>{t("orders.actions.tags")}</DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() =>
                  setViewFilters((f) => {
                    const { labelId: _labelId, ...rest } = f;
                    void _labelId;
                    return rest;
                  })
                }
              >
                {t("orders.tabs.all")}
              </DropdownMenuItem>
              {[...labelsById.values()].map((label) => (
                <DropdownMenuItem
                  key={label.id}
                  onSelect={() => setViewFilters((f) => ({ ...f, labelId: label.id }))}
                >
                  {label.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {isDesktop ? (
          <div className="text-end">
            <h1 className="text-display text-foreground">{t("orders.title")}</h1>
            <p className="text-body text-muted-foreground">{t("orders.subtitle")}</p>
          </div>
        ) : null}
      </header>

      {/* A drag is silent to a screen reader — every move is announced here. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <OrdersFilterBar
        search={search}
        onSearchChange={setSearch}
        status={status}
        dateFrom={dateFrom}
        onDateFromChange={setDateFrom}
        dateTo={dateTo}
        onDateToChange={setDateTo}
        paymentStatus={paymentFilter}
        onPaymentStatusChange={setPaymentFilter}
        onReset={resetFilters}
        t={t}
      />

      {/* Status tabs — phone only now. On desktop the board's columns ARE the
          statuses, so a tab strip above it would be a second, redundant copy of
          the same axis; on a phone there is no board, so the strip still is the
          only way to narrow by status. */}
      {isDesktop ? null : (
        <div
          className={cn(
            "flex gap-1.5 rounded-2xl border border-border bg-card p-1.5 shadow-xs",
            "flex-nowrap overflow-x-auto hide-scrollbar lg:flex-wrap lg:overflow-x-visible",
          )}
          role="tablist"
          aria-label={t("orders.title")}
        >
          <StatusTab
            label={t("orders.tabs.all")}
            active={status === "all"}
            count={totalCount}
            onClick={() => selectStatus("all")}
          />
          {ORDER_STATUSES.map((s) => (
            <StatusTab
              key={s}
              label={t(`orders.status.${s}` as TranslationKey)}
              active={status === s}
              count={counts[s] ?? 0}
              onClick={() => selectStatus(s)}
            />
          ))}
        </div>
      )}

      <PermissionGate permission="orders.manage">
        <Modal
          open={creating}
          onOpenChange={setCreating}
          title={t("orders.actions.create")}
          closeLabel={t("orders.actions.cancel")}
          size="xl"
        >
          <OrderForm onSubmit={onCreate} onCancel={() => setCreating(false)} />
        </Modal>
      </PermissionGate>

      {/* Full-width table (no more filter sidebar). */}
      <div className="flex min-w-0 flex-col gap-4">
        {isDesktop ? (
          <BulkActionsBar
            count={selection.selectedIds.size}
            onClear={selection.clear}
            countLabel={(n) => t("orders.bulk.selected").replace("{{count}}", String(n))}
            clearLabel={t("orders.bulk.clear")}
            actions={
              <>
                <PermissionGate permission="orders.manage">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        {t("orders.bulk.changeStatus")}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {bulkStatusTargets.map((s) => (
                        <DropdownMenuItem key={s} onSelect={() => void onBulkStatus(s)}>
                          {t(`orders.status.${s}` as TranslationKey)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </PermissionGate>
                <PermissionGate permission="orders.assign">
                  <Button variant="outline" size="sm" onClick={() => void onBulkAssign()}>
                    {t("orders.bulk.assign")}
                  </Button>
                </PermissionGate>
                {singleSelectedOrder !== null ? (
                  <PermissionGate permission="shipping.manage" feature="shipping">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShippingOrder(singleSelectedOrder)}
                    >
                      {t("shipping.actions.create")}
                    </Button>
                  </PermissionGate>
                ) : null}
              </>
            }
          />
        ) : null}

        {state.kind === "error" ? <ErrorState onRetry={() => void reload()} /> : null}

        {state.kind !== "error" ? (
          isDesktop ? (
            <OrdersBoard
              orders={visibleRows}
              counts={counts}
              draggingId={draggingId}
              dragProps={dragProps}
              dropTarget={dropTarget}
              onOpen={setSelectedOrder}
              hasMore={(column) => (boardCursors[column] ?? null) !== null}
              onLoadMore={(column) => void loadMoreColumn(column)}
              loadingMore={loadingColumn}
              selectedIds={selection.selectedIds}
              onToggleSelect={selection.onToggle}
              onChangeStatus={(order, to) => {
                if (to === "cancelled") {
                  setCancelling([order.id]);
                  return;
                }
                moveOrder(order, to);
              }}
              canManage={canManageOrders}
              t={t}
              locale={locale}
            />
          ) : (
            <MobileCardList<OrderListItem>
              items={visibleRows}
              loading={state.kind === "loading"}
              getRowId={(row) => row.id}
              renderCard={(order) => (
                <OrderCard
                  order={order}
                  t={t}
                  locale={locale}
                  sendingWhatsapp={sendingWhatsappId === order.id}
                  onOpenDetail={setSelectedOrder}
                  onSendWhatsapp={() => void sendWhatsapp(order, order.status as WhatsappStatus)}
                />
              )}
              emptyTitle={t("orders.empty")}
              hasMore={state.kind === "ready" && state.nextCursor !== null}
              onLoadMore={loadMore}
              loadMoreLabel={t("orders.loadMore")}
            />
          )
        ) : null}

        {state.kind === "ready" && visibleRows.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-caption text-muted-foreground">
            <span dir="ltr" className="tabular-nums">
              {t("orders.footer.showing", { count: visibleRows.length, total: totalCount })}
            </span>
            {state.nextCursor !== null ? (
              <Button variant="outline" size="sm" onClick={() => void loadMore()}>
                {t("orders.loadMore")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <DetailPanel
        open={selectedOrder !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedOrder(null);
        }}
        title={
          selectedOrder !== null
            ? t("orders.detail.title", { number: selectedOrder.orderNumber })
            : ""
        }
        sections={detailSections}
        loading={detailData.loading}
        error={detailData.error}
        onRetry={detailData.reload}
        {...(detailHeader ?? {})}
      />

      {shippingOrder !== null ? (
        <SelectCarrierDialog
          open={shippingOrder !== null}
          onOpenChange={(open) => {
            if (!open) setShippingOrder(null);
          }}
          orderId={shippingOrder.id}
          customerId={shippingOrder.customerId}
          onCreated={() => {
            flash(t("shipping.saved"));
            selection.clear();
            setShippingOrder(null);
            void reload();
          }}
        />
      ) : null}

      {waPrompt !== null ? (
        <WhatsappPromptCard
          order={waPrompt}
          t={t}
          sending={sendingWhatsappId === waPrompt.id}
          onSend={() => {
            void sendWhatsapp(waPrompt, waPrompt.status as WhatsappStatus).then(() =>
              setWaPrompt(null),
            );
          }}
          onDismiss={() => setWaPrompt(null)}
        />
      ) : null}

      <Modal
        open={cancelling !== null}
        onOpenChange={(next) => {
          if (!next && !cancelPending) {
            setCancelling(null);
            setCancelReasonId("");
          }
        }}
        title={t("orders.cancelModal.title")}
        closeLabel={t("orders.cancelModal.cancel")}
        size="sm"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
          <FormField
            label={t("orders.cancelModal.reasonLabel")}
            htmlFor="cancel-order-reason"
            required
          >
            <Combobox
              id="cancel-order-reason"
              ariaLabel={t("orders.cancelModal.reasonLabel")}
              value={cancelReasonId}
              onChange={setCancelReasonId}
              disabled={cancelPending}
              placeholder={t("orders.cancelModal.reasonPlaceholder")}
              options={cancelReasons.map((r) => ({ value: r.id, label: r.name }))}
            />
          </FormField>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={cancelPending}
            onClick={() => {
              setCancelling(null);
              setCancelReasonId("");
            }}
          >
            {t("orders.cancelModal.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={cancelReasonId === "" || cancelPending}
            onClick={() => void confirmCancel()}
          >
            {cancelPending ? <Spinner className="h-4 w-4" /> : t("orders.cancelModal.confirm")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/**
 * Floating "send the customer a WhatsApp message?" card, offered right after
 * a single order's status lands on `confirming`/`ready`/`shipped`. Purely a
 * prompt — dismissing it does nothing; sending opens `wa.me` in a new tab for
 * the user to review and send themselves (no message ever goes out on its
 * own).
 */
function WhatsappPromptCard({
  order,
  t,
  sending,
  onSend,
  onDismiss,
}: {
  order: OrderListItem;
  t: Translate;
  sending: boolean;
  onSend: () => void;
  onDismiss: () => void;
}): ReactNode {
  return (
    <div
      role="alertdialog"
      aria-label={t("orders.whatsapp.promptTitle")}
      className="fixed bottom-4 start-4 end-4 z-50 mx-auto flex max-w-sm flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-lg sm:end-4 sm:start-auto"
    >
      <div className="flex items-start gap-2">
        <WhatsAppIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#25D366]" />
        <p className="text-sm font-medium">
          #{order.orderNumber} · {t("orders.whatsapp.promptTitle")}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={sending}
          className="bg-[#25D366] text-white hover:bg-[#1ebe57]"
          onClick={onSend}
        >
          {sending ? (
            <Spinner className="h-4 w-4 text-white" />
          ) : (
            <WhatsAppIcon className="h-4 w-4" />
          )}
          {t("orders.whatsapp.send")}
        </Button>
        <Button size="sm" variant="ghost" disabled={sending} onClick={onDismiss}>
          {t("orders.actions.cancel")}
        </Button>
      </div>
    </div>
  );
}

function StatusTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-150",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-xs tabular-nums",
          active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
        )}
        dir="ltr"
      >
        {count}
      </span>
    </button>
  );
}

/** Mobile card row (ADR-002 independently-designed mobile UX). Tapping opens the shared DetailPanel. */
function OrderCard({
  order,
  t,
  locale,
  sendingWhatsapp,
  onOpenDetail,
  onSendWhatsapp,
}: {
  order: OrderListItem;
  t: Translate;
  locale: string;
  sendingWhatsapp: boolean;
  onOpenDetail: (order: OrderListItem) => void;
  onSendWhatsapp: () => void;
}): ReactNode {
  // A list row, not a stacked table: the order number leads, the customer is the
  // title, the money is the trailing value, and the rest is one secondary line.
  return (
    <div className="card-raised overflow-hidden rounded-xl border border-border bg-card">
      <MobileListRow
        onPress={() => onOpenDetail(order)}
        leading={
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-caption font-semibold text-muted-foreground"
            dir="ltr"
          >
            #{order.orderNumber}
          </span>
        }
        title={order.customerName}
        // Status and size only: the money already reads down the trailing edge,
        // and a secondary line that has to be truncated tells the user nothing.
        secondary={
          <span className="flex items-center gap-2">
            <StatusBadge
              status={order.status}
              label={t(`orders.status.${order.status}` as TranslationKey)}
            />
            <span>
              {t("orders.field.items")}: {order.itemCount}
            </span>
          </span>
        }
        trailing={
          <span className="flex flex-col items-end gap-1">
            <span className="text-body font-semibold text-foreground">
              {formatMoney(order.total, locale)}
            </span>
            <PaymentBadge
              status={order.paymentStatus}
              label={t(`orders.payment.${order.paymentStatus}` as TranslationKey)}
            />
          </span>
        }
      />
      {isWhatsappStatus(order.status) ? (
        <div className="border-t border-border px-4 py-2">
          <Button
            size="sm"
            className="bg-[#25D366] text-white hover:bg-[#1ebe57]"
            disabled={sendingWhatsapp}
            onClick={onSendWhatsapp}
          >
            {sendingWhatsapp ? (
              <Spinner className="h-4 w-4 text-white" />
            ) : (
              <WhatsAppIcon className="h-4 w-4" />
            )}
            {t("orders.whatsapp.rowButtonLabel")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function toListItem(detail: OrderDetail): OrderListItem {
  const { items: _items, notes: _notes, ...rest } = detail;
  void _items;
  void _notes;
  return rest;
}

interface StockShortage {
  variantName: string;
  productName: string;
  requested: number;
  available: number;
}

/** Pulls the `shortages` array out of an insufficient-stock 422's `details`, if present. */
function stockShortages(error: ApiError): StockShortage[] | null {
  for (const detail of error.fieldErrors as unknown as { shortages?: unknown }[]) {
    if (Array.isArray(detail.shortages) && detail.shortages.length > 0) {
      return detail.shortages as StockShortage[];
    }
  }
  return null;
}

function saveErrorText(error: unknown, t: Translate): string {
  if (error instanceof ApiError && error.code === "UNPROCESSABLE_ENTITY") {
    // Insufficient-stock errors carry a specific, actionable business message
    // from the backend (e.g. which product/variant is short and by how
    // much) — surface it verbatim instead of the generic "not allowed"
    // message so the user knows exactly what to fix.
    const shortages = stockShortages(error);
    if (shortages !== null) {
      if (shortages.length === 1) return error.message;
      const lines = shortages
        .map(
          (s) =>
            `${s.productName} - ${s.variantName}: ${t("orders.stockShortageLine", { requested: s.requested, available: s.available })}`,
        )
        .join("\n");
      return `${error.message}\n${lines}`;
    }
    return t("orders.invalid");
  }
  return t("orders.saveFailed");
}
