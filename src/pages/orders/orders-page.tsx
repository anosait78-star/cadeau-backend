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
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { TableToolbar } from "@/components/table-toolbar/table-toolbar";
import { useToast } from "@/components/toast/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listCustomers } from "@/features/customers/customers-api";
import { listItems as listMasterDataItems } from "@/features/master-data/master-data-api";
import {
  bulkAssign,
  bulkStatus,
  createOrder,
  listOrders,
  orderStatusCounts,
  ORDER_STATUSES,
  parseOrder,
  transitionOrder,
  type CreateOrderInput,
  type ListOptions,
  type OrderDetail,
  type OrderItemInput,
  type OrderListItem,
  type OrderStatus,
  type ParsedDraft,
} from "@/features/orders/orders-api";
import { getProduct, listProducts, type ProductVariant } from "@/features/products/products-api";
import { useIsDesktop } from "@/hooks/use-media-query";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { ApiError } from "@/lib/api-client";
import { buildOrderColumns, PaymentBadge, StatusBadge, type OrderLabel } from "./orders-columns";
import { buildOrderDetailSections, useOrderDetailData } from "./orders-detail-sections";
import { downloadCsv, ordersToCsv } from "./orders-export";
import { buildOrdersKpis } from "./orders-kpis";
import { OrderRowActions, TRANSITIONS } from "./orders-row-actions";
import { builtInViews, useSavedViews, type SavedView } from "./orders-saved-views";

const DASH = "—";

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

  const [state, setState] = useState<State>({ kind: "loading" });
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [viewFilters, setViewFilters] = useState<ListOptions>({});
  const [activeViewId, setActiveViewId] = useState("all");
  const [sortDesc, setSortDesc] = useState(true);
  const [creating, setCreating] = useState(false);
  const [labelsById, setLabelsById] = useState<Map<string, OrderLabel>>(new Map());
  const [selectedOrder, setSelectedOrder] = useState<OrderListItem | null>(null);
  const [kpis, setKpis] = useState<ReturnType<typeof buildOrdersKpis> | null>(null);

  const selection = useDataGridSelection();
  const { customViews, save: saveView } = useSavedViews(currentUserId);
  const views = useMemo(
    () => [...builtInViews(currentUserId), ...customViews],
    [currentUserId, customViews],
  );

  const toast = useToast();
  const flash = useCallback((text: string): void => toast.show(text), [toast]);

  const baseQuery = useCallback(
    (): ListOptions => ({
      ...viewFilters,
      ...(status !== "all" ? { status } : {}),
      ...(search.trim().length > 0 ? { q: search.trim() } : {}),
      ...(sortDesc ? { sort: "-createdAt" } : {}),
    }),
    [viewFilters, status, search, sortDesc],
  );

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
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const range = { createdAtFrom: startOfToday.toISOString() };
    void Promise.all([
      orderStatusCounts({}),
      orderStatusCounts(range),
      listOrders({ ...range, sort: "-createdAt" }),
    ])
      .then(([all, today, todayOrders]) =>
        setKpis(
          buildOrdersKpis({
            allCounts: all.counts,
            todayCounts: today.counts,
            todayOrders: todayOrders.data,
            todayOrdersHasMore: todayOrders.page.hasMore,
          }),
        ),
      )
      .catch(() => setKpis(null));
  }, [state.kind === "ready" ? state.items.length : -1]);

  const selectStatus = (next: OrderStatus | "all"): void => {
    setStatus(next);
  };

  const applyView = (view: SavedView): void => {
    setActiveViewId(view.id);
    setViewFilters(view.filters);
    setStatus("all");
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
      patchRow(await transitionOrder(id, { toStatus }));
      flash(t("orders.saved"));
      void refreshCounts();
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
    try {
      const { results } = await bulkStatus([...selection.selectedIds], toStatus);
      const failed = results.filter((r) => !r.ok);
      selection.clear();
      flash(failed.length > 0 ? t("orders.saveFailed") : t("orders.saved"));
      void load();
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

  const bulkStatusTargets = useMemo(() => {
    if (state.kind !== "ready") return [];
    const selectedOrders = state.items.filter((o) => selection.selectedIds.has(o.id));
    if (selectedOrders.length === 0) return [];
    return ORDER_STATUSES.filter((s) =>
      selectedOrders.every((o) => TRANSITIONS[o.status].includes(s)),
    );
  }, [state, selection.selectedIds]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("orders.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("orders.subtitle")}</p>
      </header>

      {kpis !== null ? <KpiRow kpis={kpis} t={t} locale={locale} /> : null}

      {/* Saved views */}
      <div className="flex flex-wrap gap-2">
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            onClick={() => applyView(view)}
            className={`rounded-full border px-3 py-1 text-xs ${
              activeViewId === view.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-input text-muted-foreground hover:bg-muted"
            }`}
          >
            {isBuiltInView(view.id) ? t(view.name as TranslationKey) : view.name}
          </button>
        ))}
        <button
          type="button"
          className="rounded-full border border-dashed border-input px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
          onClick={() => {
            const name = window.prompt(t("orders.savedViews.label"));
            if (name !== null && name.trim().length > 0) saveView(name.trim(), baseQuery());
          }}
        >
          + {t("orders.savedViews.label")}
        </button>
      </div>

      {/* Status tabs with live counts. */}
      <div
        className="flex flex-wrap gap-1 rounded-lg bg-muted p-1"
        role="tablist"
        aria-label={t("orders.title")}
      >
        <StatusTab
          label={t("orders.tabs.all")}
          active={status === "all"}
          count={Object.values(counts).reduce((a, b) => a + b, 0)}
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

      <TableToolbar
        search={{
          value: search,
          onChange: setSearch,
          onSubmit: () => void load(),
          placeholder: t("orders.search.placeholder"),
          label: t("orders.search.label"),
        }}
        secondaryActions={
          <>
            <Button variant="outline" size="sm" onClick={onExport}>
              {t("orders.actions.export")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              {t("orders.actions.print")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  {t("orders.actions.tags")}
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
          </>
        }
        primaryActions={
          <PermissionGate permission="orders.manage">
            {creating ? null : (
              <Button onClick={() => setCreating(true)}>{t("orders.actions.create")}</Button>
            )}
          </PermissionGate>
        }
      />

      {creating ? (
        <PermissionGate permission="orders.manage">
          <OrderForm onSubmit={onCreate} onCancel={() => setCreating(false)} />
        </PermissionGate>
      ) : null}

      {isDesktop ? (
        <BulkActionsBar
          count={selection.selectedIds.size}
          onClear={selection.clear}
          countLabel={(n) => t("orders.bulk.selected").replace("{{count}}", String(n))}
          clearLabel={t("orders.bulk.clear")}
          actions={
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
          }
        />
      ) : null}

      {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}

      {state.kind !== "error" ? (
        isDesktop ? (
          <DataGrid<OrderListItem>
            columns={columns}
            rows={state.kind === "ready" ? state.items : []}
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
              <OrderRowActions
                order={row}
                t={t}
                onOpenDetail={setSelectedOrder}
                onTransition={onTransition}
                onCancelRequiresReason={() => flash(t("orders.reasonRequired"))}
              />
            )}
            emptyState={<EmptyState title={t("orders.empty")} />}
            sortHintLabel={t("orders.grid.sortHint")}
          />
        ) : (
          <MobileCardList<OrderListItem>
            items={state.kind === "ready" ? state.items : []}
            loading={state.kind === "loading"}
            getRowId={(row) => row.id}
            renderCard={(order) => (
              <OrderCard order={order} t={t} locale={locale} onOpenDetail={setSelectedOrder} />
            )}
            emptyTitle={t("orders.empty")}
            hasMore={state.kind === "ready" && state.nextCursor !== null}
            onLoadMore={loadMore}
            loadMoreLabel={t("orders.loadMore")}
          />
        )
      ) : null}

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
    </div>
  );
}

function isBuiltInView(id: string): boolean {
  return ["all", "mine", "today", "late", "cancelled"].includes(id);
}

function KpiRow({
  kpis,
  t,
  locale,
}: {
  kpis: ReturnType<typeof buildOrdersKpis>;
  t: Translate;
  locale: string;
}): ReactNode {
  const tiles: { label: string; value: string; approximate?: boolean }[] = [
    { label: t("orders.kpi.ordersToday"), value: String(kpis.ordersToday) },
    { label: t("orders.kpi.pending"), value: String(kpis.pending) },
    { label: t("orders.kpi.delivered"), value: String(kpis.delivered) },
    { label: t("orders.kpi.cancelled"), value: String(kpis.cancelled) },
    {
      label: t("orders.kpi.revenueToday"),
      value: formatMoney(kpis.revenueToday, locale),
      approximate: kpis.todayApproximate,
    },
    {
      label: t("orders.kpi.cod"),
      value: formatMoney(kpis.codToday, locale),
      approximate: kpis.todayApproximate,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">{tile.label}</p>
          <p className="text-lg font-semibold" dir="ltr">
            {tile.value}
          </p>
          {tile.approximate === true ? (
            <p className="text-[10px] text-muted-foreground">{t("orders.kpi.approximate")}</p>
          ) : null}
        </div>
      ))}
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
      className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-background/60"
      }`}
    >
      {label}
      <span className="ms-1.5 text-xs opacity-80">{count}</span>
    </button>
  );
}

/** Mobile card row (ADR-002 independently-designed mobile UX). Tapping opens the shared DetailPanel. */
function OrderCard({
  order,
  t,
  locale,
  onOpenDetail,
}: {
  order: OrderListItem;
  t: Translate;
  locale: string;
  onOpenDetail: (order: OrderListItem) => void;
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
          <StatusBadge label={t(`orders.status.${order.status}` as TranslationKey)} />
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

/** A minimal customer option for the create form. */
interface CustomerOption {
  readonly id: string;
  readonly name: string;
}

/** A flat variant option (product + variant label) for the line builder. */
interface VariantOption {
  readonly id: string;
  readonly label: string;
}

/** Create-order form: a customer, one or more variant lines, shipping/discount. */
function OrderForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (body: CreateOrderInput) => void | Promise<void>;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [lines, setLines] = useState<OrderItemInput[]>([]);
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("0");
  const [shipping, setShipping] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [paste, setPaste] = useState("");
  const [draft, setDraft] = useState<ParsedDraft | null>(null);

  useEffect(() => {
    void listCustomers({ active: true })
      .then((page) => setCustomers(page.data.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => setCustomers([]));
  }, []);

  // Build a flat variant list from the active products (product — variant).
  useEffect(() => {
    void listProducts({ active: true })
      .then(async (page) => {
        const details = await Promise.all(page.data.slice(0, 20).map((p) => getProduct(p.id)));
        const flat: VariantOption[] = [];
        for (const p of details) {
          for (const v of p.variants as ProductVariant[]) {
            flat.push({ id: v.id, label: `${p.name} — ${v.name}` });
          }
        }
        setVariants(flat);
      })
      .catch(() => setVariants([]));
  }, []);

  const addLine = (): void => {
    const qty = Math.max(1, Math.round(Number(quantity)));
    const unit = Math.max(0, Math.round(Number(price) * 100));
    if (variantId === "" || !Number.isFinite(qty)) return;
    setLines((ls) => [...ls, { variantId, quantity: qty, price: unit }]);
    setVariantId("");
    setQuantity("1");
    setPrice("0");
  };

  const submit = (): void => {
    if (customerId === "" || lines.length === 0) return;
    void onSubmit({
      customerId,
      items: lines,
      shippingFee: Math.max(0, Math.round(Number(shipping) * 100)),
      discount: Math.max(0, Math.round(Number(discount) * 100)),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("orders.actions.create")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Deterministic smart-paste (no AI): paste a chat, get detected fields. */}
        <div className="flex flex-col gap-1 rounded border border-dashed border-input p-3">
          <Label htmlFor="order-paste">{t("orders.paste.label")}</Label>
          <textarea
            id="order-paste"
            className="min-h-16 rounded border border-input bg-background px-2 py-1.5 text-sm"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => {
                void parseOrder(paste)
                  .then(setDraft)
                  .catch(() => setDraft(null));
              }}
            >
              {t("orders.paste.button")}
            </Button>
            {draft !== null ? (
              <p className="text-xs text-muted-foreground" data-testid="paste-detected">
                {t("orders.paste.detected")}: {draft.phone ?? DASH}
                {draft.items.length > 0
                  ? ` · ${draft.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}`
                  : ""}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="order-customer">{t("orders.form.customer")}</Label>
          <select
            id="order-customer"
            className="rounded border border-input bg-background px-2 py-1.5 text-sm"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">{DASH}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="flex flex-wrap items-end gap-2 rounded border border-input p-3">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="order-variant">{t("orders.form.variant")}</Label>
            <select
              id="order-variant"
              className="rounded border border-input bg-background px-2 py-1.5 text-sm"
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
            >
              <option value="">{DASH}</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex w-20 flex-col gap-1">
            <Label htmlFor="order-qty">{t("orders.form.quantity")}</Label>
            <Input
              id="order-qty"
              value={quantity}
              inputMode="numeric"
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <div className="flex w-24 flex-col gap-1">
            <Label htmlFor="order-price">{t("orders.form.price")}</Label>
            <Input
              id="order-price"
              value={price}
              inputMode="decimal"
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <Button size="sm" variant="outline" onClick={addLine} type="button">
            {t("orders.form.addLine")}
          </Button>
        </fieldset>

        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("orders.form.noLines")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {lines.map((l, i) => {
              const v = variants.find((x) => x.id === l.variantId);
              return (
                <li key={`${l.variantId}-${i}`} className="flex justify-between gap-2">
                  <span>
                    {v?.label ?? l.variantId} × {l.quantity}
                  </span>
                  <button
                    type="button"
                    className="text-muted-foreground underline"
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap gap-3">
          <div className="flex w-28 flex-col gap-1">
            <Label htmlFor="order-shipping">{t("orders.form.shipping")}</Label>
            <Input
              id="order-shipping"
              value={shipping}
              inputMode="decimal"
              onChange={(e) => setShipping(e.target.value)}
            />
          </div>
          <div className="flex w-28 flex-col gap-1">
            <Label htmlFor="order-discount">{t("orders.form.discount")}</Label>
            <Input
              id="order-discount"
              value={discount}
              inputMode="decimal"
              onChange={(e) => setDiscount(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={submit} disabled={customerId === "" || lines.length === 0}>
            {t("orders.actions.save")}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t("orders.actions.cancel")}
          </Button>
        </div>
      </CardContent>
    </Card>
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
