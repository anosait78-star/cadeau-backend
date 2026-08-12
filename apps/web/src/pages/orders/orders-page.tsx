import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Clock,
  Download,
  MoreHorizontal,
  Plus,
  Printer,
  ShoppingBag,
  Truck,
  Wallet,
} from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AuthContext } from "@/auth/auth-context";
import { FeatureGate } from "@/components/access/feature-gate";
import { PermissionGate } from "@/components/access/permission-gate";
import { BulkActionsBar } from "@/components/bulk-actions/bulk-actions-bar";
import { DataGrid } from "@/components/data-grid/data-grid";
import { MobileCardList } from "@/components/data-grid/mobile-card-list";
import { useDataGridSelection } from "@/components/data-grid/use-data-grid-selection";
import { DetailPanel } from "@/components/detail-panel/detail-panel";
import type { Translate } from "@/components/i18n/translate-type";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { useToast } from "@/components/toast/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useIsDesktop } from "@/hooks/use-media-query";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { buildOrderColumns, PaymentBadge, StatusBadge, type OrderLabel } from "./orders-columns";
import { OrderForm } from "./orders-create-form";
import { buildOrderDetailSections, useOrderDetailData } from "./orders-detail-sections";
import { downloadCsv, ordersToCsv } from "./orders-export";
import { OrdersFilterBar } from "./orders-filter-bar";
import { fetchOrdersListKpis, type OrdersListKpis } from "./orders-list-kpis";
import { OrderRowActions, TRANSITIONS } from "./orders-row-actions";
import { OrdersSparkline } from "./orders-sparkline";
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
  const auth = useContext(AuthContext);
  const currentUserId = auth?.user?.id ?? null;
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
  const [sortDesc, setSortDesc] = useState(true);
  const [creating, setCreating] = useState(false);
  const [labelsById, setLabelsById] = useState<Map<string, OrderLabel>>(new Map());
  const [selectedOrder, setSelectedOrder] = useState<OrderListItem | null>(null);
  const [kpis, setKpis] = useState<OrdersListKpis | null>(null);
  // Shipments are always created one order at a time (no bulk shipping) — set
  // when exactly one row is selected and "Create shipment" is clicked.
  const [shippingOrder, setShippingOrder] = useState<OrderListItem | null>(null);
  // The floating "send a WhatsApp message?" prompt, offered right after a
  // single order's status lands on one of WHATSAPP_STATUSES.
  const [waPrompt, setWaPrompt] = useState<OrderListItem | null>(null);
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
      ...(sortDesc ? { sort: "-createdAt" } : {}),
    };
  }, [viewFilters, dateFrom, dateTo, status, search, sortDesc]);

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
    void load();
  }, [load]);

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

  useEffect(() => {
    void fetchOrdersListKpis()
      .then(setKpis)
      .catch(() => setKpis(null));
  }, [state.kind === "ready" ? state.items.length : -1]);

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
      void load();
    } catch (error) {
      flash(saveErrorText(error, t));
    }
  };

  const onTransition = async (id: string, toStatus: OrderStatus): Promise<void> => {
    try {
      const updated = await transitionOrder(id, { toStatus });
      patchRow(updated);
      flash(t("orders.saved"));
      void refreshCounts();
      if (isWhatsappStatus(toStatus)) setWaPrompt(toListItem(updated));
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

  const onBulkStatus = async (toStatus: OrderStatus): Promise<void> => {
    if (toStatus === "cancelled") {
      flash(t("orders.reasonRequired"));
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
      void load();
      if (promptCandidate !== null && failed.length === 0 && isWhatsappStatus(toStatus)) {
        setWaPrompt({ ...promptCandidate, status: toStatus });
      }
    } catch (error) {
      flash(saveErrorText(error, t));
    }
  };

  const onBulkAssign = async (): Promise<void> => {
    if (currentUserId === null) return;
    try {
      const { results } = await bulkAssign([...selection.selectedIds], currentUserId);
      const failed = results.filter((r) => !r.ok);
      selection.clear();
      flash(failed.length > 0 ? t("orders.saveFailed") : t("orders.saved"));
      void load();
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
          t,
          locale,
          onNotify: flash,
          onPatch: (order) => {
            patchRow(order);
            detailData.setDetail(order);
          },
        })
      : [];

  const columns = useMemo(
    () => buildOrderColumns({ t, locale, labelsById }),
    [t, locale, labelsById],
  );

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
    <div className="mx-auto flex w-full max-w-[100rem] flex-col gap-6 p-4 sm:p-6">
      {/* Header: actions at the start, title/subtitle at the end (matches the app's RTL reading order). */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <PermissionGate permission="orders.manage">
            {creating ? null : (
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t("orders.actions.create")}
              </Button>
            )}
          </PermissionGate>
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

        <div className="text-end">
          <h1 className="text-display text-foreground">{t("orders.title")}</h1>
          <p className="text-body text-muted-foreground">{t("orders.subtitle")}</p>
        </div>
      </header>

      {kpis !== null ? <OrdersKpiRow kpis={kpis} t={t} locale={locale} /> : null}

      {/* Status tabs with live counts. */}
      <div
        className="flex flex-wrap gap-1.5 overflow-x-auto rounded-2xl border border-border bg-card p-1.5 shadow-xs"
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

      <OrdersFilterBar
        search={search}
        onSearchChange={setSearch}
        status={status}
        onStatusChange={selectStatus}
        dateFrom={dateFrom}
        onDateFromChange={setDateFrom}
        dateTo={dateTo}
        onDateToChange={setDateTo}
        paymentStatus={paymentFilter}
        onPaymentStatusChange={setPaymentFilter}
        onReset={resetFilters}
        t={t}
      />

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

        {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}

        {state.kind !== "error" ? (
          isDesktop ? (
            <DataGrid<OrderListItem>
              columns={columns}
              rows={visibleRows}
              getRowId={(row) => row.id}
              loading={state.kind === "loading"}
              hasMore={state.kind === "ready" && state.nextCursor !== null}
              onLoadMore={loadMore}
              sortState={{ key: "createdAt", direction: sortDesc ? "desc" : "asc" }}
              onSort={(key) => {
                if (key === "createdAt") {
                  setSortDesc((v) => !v);
                }
              }}
              selection={selection}
              onRowClick={setSelectedOrder}
              rowActions={(row) => (
                <div className="flex items-center gap-1">
                  {isWhatsappStatus(row.status) ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full bg-[#25D366] text-white hover:bg-[#1ebe57] hover:text-white"
                      title={t("orders.whatsapp.rowButtonLabel")}
                      aria-label={t("orders.whatsapp.rowButtonLabel")}
                      disabled={sendingWhatsappId === row.id}
                      onClick={() => void sendWhatsapp(row, row.status as WhatsappStatus)}
                    >
                      {sendingWhatsappId === row.id ? (
                        <Spinner className="h-4 w-4 text-white" />
                      ) : (
                        <WhatsAppIcon className="h-4 w-4" />
                      )}
                    </Button>
                  ) : null}
                  <OrderRowActions
                    order={row}
                    t={t}
                    onOpenDetail={setSelectedOrder}
                    onTransition={onTransition}
                    onCancelRequiresReason={() => flash(t("orders.reasonRequired"))}
                  />
                </div>
              )}
              rowClassName={(row) => {
                const index = visibleRows.findIndex((r) => r.id === row.id);
                return cn("[&>td]:py-3.5", index % 2 === 1 && "bg-muted/30");
              }}
              emptyState={<EmptyState title={t("orders.empty")} />}
              sortHintLabel={t("orders.grid.sortHint")}
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
        title={selectedOrder !== null ? `#${selectedOrder.orderNumber}` : ""}
        sections={detailSections}
        loading={detailData.loading}
        error={detailData.error}
        onRetry={detailData.reload}
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
            void load();
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

interface KpiTileSpec {
  readonly label: string;
  readonly value: string;
  readonly icon: ReactNode;
  readonly iconToneClassName: string;
  readonly trendPct: number | null;
  readonly series: readonly number[] | null;
  readonly approximate?: boolean;
}

function OrdersKpiRow({
  kpis,
  t,
  locale,
}: {
  kpis: OrdersListKpis;
  t: Translate;
  locale: string;
}): ReactNode {
  const tiles: KpiTileSpec[] = [
    {
      label: t("orders.kpi.cod"),
      value: formatMoney(kpis.codToday.value, locale),
      icon: <Wallet className="h-5 w-5" aria-hidden="true" />,
      iconToneClassName: "bg-success/10 text-success",
      trendPct: kpis.codToday.trendPct,
      series: null,
      approximate: kpis.codToday.approximate,
    },
    {
      label: t("orders.kpi.revenueToday"),
      value: formatMoney(kpis.revenueToday.value, locale),
      icon: <ShoppingBag className="h-5 w-5" aria-hidden="true" />,
      iconToneClassName: "bg-primary/10 text-primary",
      trendPct: kpis.revenueToday.trendPct,
      series: null,
      approximate: kpis.revenueToday.approximate,
    },
    {
      label: t("orders.kpi.shipped"),
      value: String(kpis.shipped.value),
      icon: <Truck className="h-5 w-5" aria-hidden="true" />,
      iconToneClassName: "bg-info/10 text-info",
      trendPct: kpis.shipped.trendPct,
      series: kpis.shipped.series,
    },
    {
      label: t("orders.kpi.processing"),
      value: String(kpis.processing.value),
      icon: <Clock className="h-5 w-5" aria-hidden="true" />,
      iconToneClassName: "bg-warning/10 text-warning",
      trendPct: kpis.processing.trendPct,
      series: kpis.processing.series,
    },
    {
      label: t("orders.kpi.ordersToday"),
      value: String(kpis.ordersToday.value),
      icon: <CalendarDays className="h-5 w-5" aria-hidden="true" />,
      iconToneClassName: "bg-primary/10 text-primary",
      trendPct: kpis.ordersToday.trendPct,
      series: kpis.ordersToday.series,
    },
    {
      label: t("orders.kpi.totalOrders"),
      value: String(kpis.totalOrders.value),
      icon: <ShoppingBag className="h-5 w-5" aria-hidden="true" />,
      iconToneClassName: "bg-muted text-foreground",
      trendPct: kpis.totalOrders.trendPct,
      series: kpis.totalOrders.series,
    },
  ];

  return (
    <div
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6"
      data-testid="orders-kpi-row"
    >
      {tiles.map((tile) => (
        <OrdersKpiCard key={tile.label} tile={tile} trendSuffix={t("orders.kpi.vsYesterday")} />
      ))}
    </div>
  );
}

function OrdersKpiCard({
  tile,
  trendSuffix,
}: {
  tile: KpiTileSpec;
  trendSuffix: string;
}): ReactNode {
  const trendTone =
    tile.trendPct === null
      ? "text-muted-foreground"
      : tile.trendPct > 0
        ? "text-success"
        : tile.trendPct < 0
          ? "text-destructive"
          : "text-muted-foreground";

  return (
    <div className="flex h-[140px] flex-col justify-between rounded-2xl border border-border bg-card p-4 shadow-xs">
      <div className="flex items-start justify-between">
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full",
            tile.iconToneClassName,
          )}
        >
          {tile.icon}
        </span>
        {tile.series !== null ? (
          <OrdersSparkline
            values={tile.series}
            className="h-6 w-16"
            toneClassName="text-muted-foreground"
          />
        ) : null}
      </div>
      <div>
        <p className="truncate text-caption text-muted-foreground">{tile.label}</p>
        <p className="text-h1 leading-tight text-foreground tabular-nums" dir="ltr">
          {tile.value}
        </p>
      </div>
      <div className={cn("flex items-center gap-1 text-caption", trendTone)}>
        {tile.trendPct !== null && tile.trendPct !== 0 ? (
          tile.trendPct > 0 ? (
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
          )
        ) : null}
        <span dir="ltr">
          {tile.trendPct === null
            ? "—"
            : `${tile.trendPct > 0 ? "+" : ""}${tile.trendPct.toFixed(1)}%`}
        </span>
        <span className="truncate text-muted-foreground">
          {tile.approximate === true ? "· ≈" : trendSuffix}
        </span>
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
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onOpenDetail(order)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpenDetail(order);
      }}
      className="cursor-pointer"
    >
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span>#{order.orderNumber}</span>
          <span className="text-muted-foreground">·</span>
          <span>{order.customerName}</span>
          <StatusBadge
            status={order.status}
            label={t(`orders.status.${order.status}` as TranslationKey)}
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <Field label={t("orders.field.items")}>{order.itemCount}</Field>
          <Field label={t("orders.field.total")}>{formatMoney(order.total, locale)}</Field>
          <Field label={t("orders.field.collected")}>
            {formatMoney(order.collectedAmount, locale)}
          </Field>
          <Field label={t("orders.field.payment")}>
            <PaymentBadge
              status={order.paymentStatus}
              label={t(`orders.payment.${order.paymentStatus}` as TranslationKey)}
            />
          </Field>
        </dl>
        {isWhatsappStatus(order.status) ? (
          <Button
            size="sm"
            className="self-start bg-[#25D366] text-white hover:bg-[#1ebe57]"
            disabled={sendingWhatsapp}
            onClick={(e) => {
              e.stopPropagation();
              onSendWhatsapp();
            }}
          >
            {sendingWhatsapp ? (
              <Spinner className="h-4 w-4 text-white" />
            ) : (
              <WhatsAppIcon className="h-4 w-4" />
            )}
            {t("orders.whatsapp.rowButtonLabel")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function toListItem(detail: OrderDetail): OrderListItem {
  const { items: _items, notes: _notes, ...rest } = detail;
  void _items;
  void _notes;
  return rest;
}

function formatMoney(minorUnits: number, locale: string): string {
  return (minorUnits / 100).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
