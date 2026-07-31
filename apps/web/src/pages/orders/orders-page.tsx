import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { FeatureGate } from "@/components/access/feature-gate";
import { PermissionGate } from "@/components/access/permission-gate";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listCustomers } from "@/features/customers/customers-api";
import {
  assignOrder,
  createOrder,
  getOrder,
  listOrderActivity,
  listOrders,
  orderStatusCounts,
  ORDER_STATUSES,
  parseOrder,
  transitionOrder,
  updateOrder,
  type CreateOrderInput,
  type OrderActivity,
  type OrderDetail,
  type OrderItemInput,
  type OrderListItem,
  type OrderStatus,
  type ParsedDraft,
} from "@/features/orders/orders-api";
import { getProduct, listProducts, type ProductVariant } from "@/features/products/products-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { ApiError } from "@/lib/api-client";

type Translate = (key: TranslationKey) => string;

const DASH = "—";

/** All valid next states per current state (mirrors the server state machine). */
const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
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

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly items: OrderListItem[]; readonly nextCursor: string | null };

/**
 * Orders — the order lifecycle (EPIC-11). The whole screen is behind the `orders`
 * feature; create/edit/status/assign are behind `orders.manage` (the API
 * re-checks both — ADR-003). One responsive card list serves both shells (the
 * card alternative required by ADR-002), with status tabs + live counts.
 */
export function OrdersPage(): ReactNode {
  const { t } = useI18n();
  return (
    <FeatureGate
      feature="orders"
      fallback={
        <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
          <EmptyState title={t("orders.forbidden")} />
        </div>
      }
    >
      <OrdersScreen />
    </FeatureGate>
  );
}

function OrdersScreen(): ReactNode {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const flash = useCallback((text: string): void => {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 2500);
  }, []);

  const filters = useCallback(
    (extra: { cursor?: string } = {}) => ({
      ...(status !== "all" ? { status } : {}),
      ...(search.trim().length > 0 ? { q: search.trim() } : {}),
      ...extra,
    }),
    [status, search],
  );

  const load = useCallback(async (nextStatus: OrderStatus | "all", q: string): Promise<void> => {
    setState({ kind: "loading" });
    const query = {
      ...(nextStatus !== "all" ? { status: nextStatus } : {}),
      ...(q.length > 0 ? { q } : {}),
    };
    try {
      const [page, tabs] = await Promise.all([listOrders(query), orderStatusCounts(query)]);
      setState({ kind: "ready", items: page.data, nextCursor: page.page.nextCursor });
      setCounts(tabs.counts);
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load("all", "");
  }, [load]);

  const selectStatus = (next: OrderStatus | "all"): void => {
    setStatus(next);
    void load(next, search.trim());
  };

  const loadMore = async (): Promise<void> => {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    const page = await listOrders(filters({ cursor: state.nextCursor }));
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
      void load(status, search.trim());
    } catch (error) {
      flash(saveErrorText(error, t));
    }
  };

  const onTransition = async (
    id: string,
    toStatus: OrderStatus,
    reasonId: string | null,
  ): Promise<void> => {
    try {
      patchRow(await transitionOrder(id, { toStatus, ...(reasonId !== null ? { reasonId } : {}) }));
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

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("orders.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("orders.subtitle")}</p>
      </header>

      {/* Status tabs with live counts (the card alternative to a data grid). */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("orders.title")}>
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

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="orders-search">{t("orders.search.label")}</Label>
          <Input
            id="orders-search"
            value={search}
            placeholder={t("orders.search.placeholder")}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load(status, search.trim());
            }}
          />
        </div>
        <Button variant="outline" onClick={() => void load(status, search.trim())}>
          {t("orders.search.submit")}
        </Button>
        <PermissionGate permission="orders.manage">
          {creating ? null : (
            <Button onClick={() => setCreating(true)}>{t("orders.actions.create")}</Button>
          )}
        </PermissionGate>
      </div>

      {notice !== null ? (
        <p className="text-sm text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}

      {creating ? (
        <PermissionGate permission="orders.manage">
          <OrderForm onSubmit={onCreate} onCancel={() => setCreating(false)} />
        </PermissionGate>
      ) : null}

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? (
        <ErrorState onRetry={() => void load(status, search.trim())} />
      ) : null}
      {state.kind === "ready" && state.items.length === 0 ? (
        <EmptyState title={t("orders.empty")} />
      ) : null}

      {state.kind === "ready" && state.items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {state.items.map((order) => (
            <li key={order.id}>
              <OrderCard
                order={order}
                onTransition={onTransition}
                onNotify={flash}
                onPatch={patchRow}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {state.kind === "ready" && state.nextCursor !== null ? (
        <Button variant="outline" onClick={() => void loadMore()} className="self-center">
          {t("orders.loadMore")}
        </Button>
      ) : null}
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
      className={`rounded-full border px-3 py-1 text-sm ${
        active ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background"
      }`}
    >
      {label}
      <span className="ms-1.5 text-xs opacity-80">{count}</span>
    </button>
  );
}

/** One order row: header facts, actions, and an expandable detail panel. */
function OrderCard({
  order,
  onTransition,
  onNotify,
  onPatch,
}: {
  order: OrderListItem;
  onTransition: (id: string, to: OrderStatus, reasonId: string | null) => void | Promise<void>;
  onNotify: (text: string) => void;
  onPatch: (order: OrderDetail) => void;
}): ReactNode {
  const { t, locale } = useI18n();
  const [showDetail, setShowDetail] = useState(false);
  const nextStates = TRANSITIONS[order.status];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span>#{order.orderNumber}</span>
          <span className="text-muted-foreground">·</span>
          <span>{order.customerName}</span>
          <span
            className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground"
            data-testid="status"
          >
            {t(`orders.status.${order.status}` as TranslationKey)}
          </span>
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
            {t(`orders.payment.${order.paymentStatus}` as TranslationKey)}
          </Field>
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowDetail((v) => !v)}>
            {t("orders.actions.details")}
          </Button>
          <PermissionGate permission="orders.manage">
            {nextStates.length > 0 ? (
              <label className="flex items-center gap-1 text-sm">
                <span className="text-muted-foreground">{t("orders.actions.changeStatus")}</span>
                <select
                  className="rounded border border-input bg-background px-2 py-1 text-sm"
                  value=""
                  onChange={(e) => {
                    const to = e.target.value as OrderStatus;
                    if (to === "cancelled") {
                      onNotify(t("orders.reasonRequired"));
                      return;
                    }
                    void onTransition(order.id, to, null);
                  }}
                >
                  <option value="" disabled>
                    {DASH}
                  </option>
                  {nextStates.map((s) => (
                    <option key={s} value={s}>
                      {t(`orders.status.${s}` as TranslationKey)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </PermissionGate>
        </div>

        {showDetail ? (
          <DetailPanel orderId={order.id} onNotify={onNotify} onPatch={onPatch} />
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

/** The detail panel for one order, loaded on expand: items, activity, collection. */
function DetailPanel({
  orderId,
  onNotify,
  onPatch,
}: {
  orderId: string;
  onNotify: (text: string) => void;
  onPatch: (order: OrderDetail) => void;
}): ReactNode {
  const { t, locale } = useI18n();
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [activity, setActivity] = useState<OrderActivity[]>([]);
  const [failed, setFailed] = useState(false);
  const [collect, setCollect] = useState("");

  const load = useCallback(async (): Promise<void> => {
    setFailed(false);
    try {
      const [d, a] = await Promise.all([getOrder(orderId), listOrderActivity(orderId)]);
      setDetail(d);
      setActivity(a.data);
    } catch {
      setFailed(true);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCollect = async (): Promise<void> => {
    const minor = Math.round(Number(collect) * 100);
    if (!Number.isFinite(minor) || minor < 0) return;
    try {
      const updated = await updateOrder(orderId, { collectedAmount: minor });
      setDetail(updated);
      onPatch(updated);
      setCollect("");
      onNotify(t("orders.saved"));
    } catch {
      onNotify(t("orders.saveFailed"));
    }
  };

  if (failed) return <ErrorState onRetry={() => void load()} />;
  if (detail === null) return <LoadingState />;

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <div>
        <h3 className="mb-1 text-sm font-medium">{t("orders.detail.items")}</h3>
        <ul className="flex flex-col gap-1 text-sm">
          {detail.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-2">
              <span>
                {item.nameSnapshot} × {item.quantity}
              </span>
              <span dir="ltr">{formatMoney(item.price * item.quantity, locale)}</span>
            </li>
          ))}
        </ul>
      </div>

      <PermissionGate permission="orders.manage">
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`collect-${orderId}`}>{t("orders.detail.collect")}</Label>
            <Input
              id={`collect-${orderId}`}
              value={collect}
              inputMode="decimal"
              onChange={(e) => setCollect(e.target.value)}
            />
          </div>
          <Button size="sm" variant="outline" onClick={() => void onCollect()}>
            {t("orders.actions.save")}
          </Button>
        </div>
      </PermissionGate>

      <div>
        <h3 className="mb-1 text-sm font-medium">{t("orders.detail.activity")}</h3>
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">{DASH}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {activity.map((a) => (
              <li key={a.id} className="flex justify-between gap-2 text-muted-foreground">
                <span>
                  {a.kind}
                  {a.fromValue !== null && a.toValue !== null
                    ? `: ${a.fromValue} → ${a.toValue}`
                    : a.toValue !== null
                      ? `: ${a.toValue}`
                      : ""}
                </span>
                <span dir="ltr">{formatDate(a.createdAt, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
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

// Keep assignOrder referenced for a future assignee picker (API is wired).
void assignOrder;

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

function formatDate(iso: string | null, locale: string): string {
  return iso === null ? DASH : new Date(iso).toLocaleDateString(locale);
}

function saveErrorText(error: unknown, t: Translate): string {
  if (error instanceof ApiError && error.code === "UNPROCESSABLE_ENTITY") {
    return t("orders.invalid");
  }
  return t("orders.saveFailed");
}
