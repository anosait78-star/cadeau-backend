import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { FeatureGate } from "@/components/access/feature-gate";
import { PermissionGate } from "@/components/access/permission-gate";
import { StatusBadge } from "@/components/status-badge/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCapabilities } from "@/features/access/use-capabilities";
import { getBusinessAnalytics, type BusinessSummary } from "@/features/analytics/analytics-api";
import { listCustomers } from "@/features/customers/customers-api";
import { listStock, type StockLevel } from "@/features/inventory/inventory-api";
import {
  listNotifications,
  type NotificationItem,
} from "@/features/notifications/notifications-api";
import { listOrders, orderStatusCounts, type OrderListItem } from "@/features/orders/orders-api";
import { fetchOrdersKpis, sumCounts, type OrdersKpis } from "@/features/orders/orders-kpis";
import { listProducts, listVariants } from "@/features/products/products-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";
import { SalesChart, StatusChart } from "./dashboard-charts";

const RECENT_ORDERS_LIMIT = 5;
const RECENT_ACTIVITY_LIMIT = 6;
const LOW_STOCK_LIMIT = 5;

type Section<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly data: T };

interface Counted {
  readonly count: number;
  /** True when the true total may be larger — the count is a first-page sample, not exact. */
  readonly approximate: boolean;
}

interface LowStock {
  readonly rows: readonly StockLevel[];
  readonly hasMore: boolean;
  readonly labelFor: (variantId: string) => string;
}

/**
 * The authenticated landing page ("/"). Every widget reuses its module's own
 * `features/*-api.ts` client and permission model — this page fetches and
 * composes, it never re-derives business logic (order lifecycle, low-stock
 * threshold, KPI math already live in `orders-kpis.ts` / the analytics/
 * inventory APIs). A widget whose feature/permission is unavailable, or whose
 * fetch fails, is simply omitted — never backfilled with placeholder data.
 */
export function DashboardPage(): ReactNode {
  const { t, locale } = useI18n();
  const { has } = useCapabilities();

  const [kpis, setKpis] = useState<Section<OrdersKpis>>({ kind: "loading" });
  const [statusCounts, setStatusCounts] = useState<Section<Record<string, number>>>({
    kind: "loading",
  });
  const [sales, setSales] = useState<Section<BusinessSummary>>({ kind: "loading" });
  const [recentOrders, setRecentOrders] = useState<Section<OrderListItem[]>>({ kind: "loading" });
  const [lowStock, setLowStock] = useState<Section<LowStock>>({ kind: "loading" });
  const [customers, setCustomers] = useState<Section<Counted>>({ kind: "loading" });
  const [products, setProducts] = useState<Section<Counted>>({ kind: "loading" });
  const [notifications, setNotifications] = useState<Section<NotificationItem[]>>({
    kind: "loading",
  });

  const canOrders = has({ feature: "orders" });
  const canCustomers = has({ feature: "customers" });
  const canProducts = has({ feature: "products" });
  const canInventory = has({ feature: "inventory" });
  const canAnalytics = has({ feature: "analytics", permission: "analytics.read" });
  const canNotifications = has({ feature: "notifications" });

  useEffect(() => {
    if (!canOrders) return;
    void fetchOrdersKpis()
      .then((data) => setKpis({ kind: "ready", data }))
      .catch(() => setKpis({ kind: "error" }));
    void orderStatusCounts({})
      .then((res) => setStatusCounts({ kind: "ready", data: res.counts }))
      .catch(() => setStatusCounts({ kind: "error" }));
    void listOrders({ sort: "-createdAt" })
      .then((page) => setRecentOrders({ kind: "ready", data: page.data }))
      .catch(() => setRecentOrders({ kind: "error" }));
  }, [canOrders]);

  useEffect(() => {
    if (!canAnalytics) return;
    void getBusinessAnalytics({})
      .then((data) => setSales({ kind: "ready", data }))
      .catch(() => setSales({ kind: "error" }));
  }, [canAnalytics]);

  useEffect(() => {
    if (!canInventory) return;
    void (async () => {
      try {
        const page = await listStock({ belowReorder: true, sort: "available" });
        let labelFor = (variantId: string): string => variantId;
        if (canProducts) {
          try {
            const productPage = await listProducts({ active: true });
            const entries = (
              await Promise.all(
                productPage.data.map(async (product) => {
                  const variants = await listVariants(product.id);
                  return variants.data.map((v): [string, string] => [
                    v.id,
                    `${product.name} — ${v.name}`,
                  ]);
                }),
              )
            ).flat();
            const byId = new Map(entries);
            labelFor = (variantId: string): string => byId.get(variantId) ?? variantId;
          } catch {
            // Best-effort naming only — the alert list still works with raw ids.
          }
        }
        setLowStock({
          kind: "ready",
          data: { rows: page.data, hasMore: page.page.hasMore, labelFor },
        });
      } catch {
        setLowStock({ kind: "error" });
      }
    })();
  }, [canInventory, canProducts]);

  useEffect(() => {
    if (!canCustomers) return;
    void listCustomers({ active: true })
      .then((page) =>
        setCustomers({
          kind: "ready",
          data: { count: page.data.length, approximate: page.page.hasMore },
        }),
      )
      .catch(() => setCustomers({ kind: "error" }));
  }, [canCustomers]);

  useEffect(() => {
    if (!canProducts) return;
    void listProducts({ active: true })
      .then((page) =>
        setProducts({
          kind: "ready",
          data: { count: page.data.length, approximate: page.page.hasMore },
        }),
      )
      .catch(() => setProducts({ kind: "error" }));
  }, [canProducts]);

  useEffect(() => {
    if (!canNotifications) return;
    void listNotifications({ read: false, limit: 5 })
      .then((page) => setNotifications({ kind: "ready", data: [...page.data] }))
      .catch(() => setNotifications({ kind: "error" }));
  }, [canNotifications]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("dashboard.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("dashboard.subtitle")}</p>
      </header>

      <KpiCards
        t={t}
        locale={locale}
        canOrders={canOrders}
        canAnalytics={canAnalytics}
        canCustomers={canCustomers}
        canProducts={canProducts}
        canInventory={canInventory}
        statusCounts={statusCounts}
        sales={sales}
        customers={customers}
        products={products}
        lowStock={lowStock}
      />

      <QuickActions t={t} />

      {canOrders ? <TodaysBusinessSummary t={t} locale={locale} kpis={kpis} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {canAnalytics ? <SalesChartCard t={t} sales={sales} /> : null}
        {canOrders ? <StatusChartCard t={t} statusCounts={statusCounts} /> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {canOrders ? <RecentOrdersCard t={t} locale={locale} recentOrders={recentOrders} /> : null}
        {canOrders ? <RecentActivityCard t={t} recentOrders={recentOrders} /> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {canInventory ? <LowStockCard t={t} lowStock={lowStock} /> : null}
        <FeatureGate feature="notifications">
          <NotificationsSummaryCard t={t} notifications={notifications} />
        </FeatureGate>
      </div>
    </div>
  );
}

function formatMoney(minorUnits: number, locale: string): string {
  return (minorUnits / 100).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function KpiTile({
  label,
  value,
  approximate,
}: {
  label: string;
  value: string;
  approximate: boolean;
}): ReactNode {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold" dir="ltr">
        {value}
        {approximate ? "+" : ""}
      </p>
    </div>
  );
}

function KpiCards({
  t,
  locale,
  canOrders,
  canAnalytics,
  canCustomers,
  canProducts,
  canInventory,
  statusCounts,
  sales,
  customers,
  products,
  lowStock,
}: {
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  locale: string;
  canOrders: boolean;
  canAnalytics: boolean;
  canCustomers: boolean;
  canProducts: boolean;
  canInventory: boolean;
  statusCounts: Section<Record<string, number>>;
  sales: Section<BusinessSummary>;
  customers: Section<Counted>;
  products: Section<Counted>;
  lowStock: Section<LowStock>;
}): ReactNode {
  const tiles: { key: string; label: string; value: string; approximate: boolean }[] = [];

  if (canOrders && statusCounts.kind === "ready") {
    tiles.push({
      key: "orders",
      label: t("dashboard.kpi.orders"),
      value: String(sumCounts(statusCounts.data)),
      approximate: false,
    });
  }
  if (canAnalytics && sales.kind === "ready") {
    tiles.push({
      key: "revenue",
      label: t("dashboard.kpi.revenue"),
      value: formatMoney(sales.data.collectedMinor, locale),
      approximate: false,
    });
  }
  if (canCustomers && customers.kind === "ready") {
    tiles.push({
      key: "customers",
      label: t("dashboard.kpi.customers"),
      value: String(customers.data.count),
      approximate: customers.data.approximate,
    });
  }
  if (canProducts && products.kind === "ready") {
    tiles.push({
      key: "products",
      label: t("dashboard.kpi.products"),
      value: String(products.data.count),
      approximate: products.data.approximate,
    });
  }
  if (canInventory && lowStock.kind === "ready") {
    tiles.push({
      key: "inventoryAlerts",
      label: t("dashboard.kpi.inventoryAlerts"),
      value: String(lowStock.data.rows.length),
      approximate: lowStock.data.hasMore,
    });
  }

  if (tiles.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => (
        <KpiTile
          key={tile.key}
          label={tile.label}
          value={tile.value}
          approximate={tile.approximate}
        />
      ))}
    </div>
  );
}

function QuickActionLink({ to, children }: { to: string; children: ReactNode }): ReactNode {
  return (
    <Link to={to} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
      {children}
    </Link>
  );
}

function QuickActions({ t }: { t: (key: TranslationKey) => string }): ReactNode {
  return (
    <div className="flex flex-wrap gap-2">
      <PermissionGate permission="orders.manage" feature="orders">
        <QuickActionLink to="/orders">{t("dashboard.quickActions.newOrder")}</QuickActionLink>
      </PermissionGate>
      <PermissionGate permission="customers.manage" feature="customers">
        <QuickActionLink to="/customers">{t("dashboard.quickActions.newCustomer")}</QuickActionLink>
      </PermissionGate>
      <PermissionGate permission="products.manage" feature="products">
        <QuickActionLink to="/products">{t("dashboard.quickActions.newProduct")}</QuickActionLink>
      </PermissionGate>
      <PermissionGate permission="inventory.manage" feature="inventory">
        <QuickActionLink to="/inventory">{t("dashboard.quickActions.adjustStock")}</QuickActionLink>
      </PermissionGate>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function SectionMessage({ text }: { text: string }): ReactNode {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

function TodaysBusinessSummary({
  t,
  locale,
  kpis,
}: {
  t: (key: TranslationKey) => string;
  locale: string;
  kpis: Section<OrdersKpis>;
}): ReactNode {
  if (kpis.kind === "loading") return null;
  if (kpis.kind === "error") {
    return (
      <SectionCard title={t("dashboard.today.title")}>
        <SectionMessage text={t("dashboard.loadFailed")} />
      </SectionCard>
    );
  }
  const { data } = kpis;
  const tiles = [
    { label: t("orders.kpi.ordersToday"), value: String(data.ordersToday) },
    { label: t("orders.kpi.pending"), value: String(data.pending) },
    { label: t("orders.kpi.delivered"), value: String(data.delivered) },
    { label: t("orders.kpi.cancelled"), value: String(data.cancelled) },
    { label: t("orders.kpi.revenueToday"), value: formatMoney(data.revenueToday, locale) },
    { label: t("orders.kpi.cod"), value: formatMoney(data.codToday, locale) },
  ];
  return (
    <SectionCard title={t("dashboard.today.title")}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((tile) => (
          <div key={tile.label} className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{tile.label}</dt>
            <dd className="tabular-nums" dir="ltr">
              {tile.value}
            </dd>
          </div>
        ))}
      </dl>
      {data.todayApproximate ? (
        <p className="mt-2 text-[10px] text-muted-foreground">{t("orders.kpi.approximate")}</p>
      ) : null}
    </SectionCard>
  );
}

function SalesChartCard({
  t,
  sales,
}: {
  t: (key: TranslationKey) => string;
  sales: Section<BusinessSummary>;
}): ReactNode {
  return (
    <SectionCard title={t("dashboard.sales.title")}>
      {sales.kind === "loading" ? <SectionMessage text={t("states.loading")} /> : null}
      {sales.kind === "error" ? <SectionMessage text={t("dashboard.loadFailed")} /> : null}
      {sales.kind === "ready" ? <SalesChart points={sales.data.series} /> : null}
    </SectionCard>
  );
}

function StatusChartCard({
  t,
  statusCounts,
}: {
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  statusCounts: Section<Record<string, number>>;
}): ReactNode {
  return (
    <SectionCard title={t("dashboard.statusChart.title")}>
      {statusCounts.kind === "loading" ? <SectionMessage text={t("states.loading")} /> : null}
      {statusCounts.kind === "error" ? <SectionMessage text={t("dashboard.loadFailed")} /> : null}
      {statusCounts.kind === "ready" ? <StatusChart counts={statusCounts.data} t={t} /> : null}
    </SectionCard>
  );
}

function RecentOrdersCard({
  t,
  locale,
  recentOrders,
}: {
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  locale: string;
  recentOrders: Section<OrderListItem[]>;
}): ReactNode {
  return (
    <SectionCard title={t("dashboard.recentOrders.title")}>
      {recentOrders.kind === "loading" ? <SectionMessage text={t("states.loading")} /> : null}
      {recentOrders.kind === "error" ? <SectionMessage text={t("dashboard.loadFailed")} /> : null}
      {recentOrders.kind === "ready" && recentOrders.data.length === 0 ? (
        <SectionMessage text={t("orders.empty")} />
      ) : null}
      {recentOrders.kind === "ready" && recentOrders.data.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border">
          {recentOrders.data.slice(0, RECENT_ORDERS_LIMIT).map((order) => (
            <li key={order.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <Link to="/orders" className="flex flex-1 items-center gap-2 hover:underline">
                <span className="font-medium">#{order.orderNumber}</span>
                <span className="text-muted-foreground">{order.customerName}</span>
              </Link>
              <StatusBadge label={t(`orders.status.${order.status}` as TranslationKey)} />
              <span className="w-20 shrink-0 text-end tabular-nums" dir="ltr">
                {formatMoney(order.total, locale)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </SectionCard>
  );
}

function RecentActivityCard({
  t,
  recentOrders,
}: {
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  recentOrders: Section<OrderListItem[]>;
}): ReactNode {
  const items =
    recentOrders.kind === "ready"
      ? [...recentOrders.data]
          .sort((a, b) => b.statusChangedAt.localeCompare(a.statusChangedAt))
          .slice(0, RECENT_ACTIVITY_LIMIT)
      : [];
  return (
    <SectionCard title={t("dashboard.activity.title")}>
      {recentOrders.kind === "loading" ? <SectionMessage text={t("states.loading")} /> : null}
      {recentOrders.kind === "error" ? <SectionMessage text={t("dashboard.loadFailed")} /> : null}
      {recentOrders.kind === "ready" && items.length === 0 ? (
        <SectionMessage text={t("states.empty.title")} />
      ) : null}
      {recentOrders.kind === "ready" && items.length > 0 ? (
        <ul className="flex flex-col gap-2 text-sm">
          {items.map((order) => (
            <li key={order.id} className="flex items-center justify-between gap-2">
              <span>
                {t("dashboard.activity.line", {
                  order: order.orderNumber,
                  status: t(`orders.status.${order.status}` as TranslationKey),
                })}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground" dir="ltr">
                {new Date(order.statusChangedAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </SectionCard>
  );
}

function LowStockCard({
  t,
  lowStock,
}: {
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  lowStock: Section<LowStock>;
}): ReactNode {
  return (
    <SectionCard title={t("dashboard.lowStock.title")}>
      {lowStock.kind === "loading" ? <SectionMessage text={t("states.loading")} /> : null}
      {lowStock.kind === "error" ? <SectionMessage text={t("dashboard.loadFailed")} /> : null}
      {lowStock.kind === "ready" && lowStock.data.rows.length === 0 ? (
        <SectionMessage text={t("dashboard.lowStock.empty")} />
      ) : null}
      {lowStock.kind === "ready" && lowStock.data.rows.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border">
          {lowStock.data.rows.slice(0, LOW_STOCK_LIMIT).map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <Link to="/inventory" className="flex-1 truncate hover:underline">
                {lowStock.data.labelFor(row.variantId)}
              </Link>
              <StatusBadge
                tone={row.available <= 0 ? "destructive" : "warning"}
                label={String(row.available)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </SectionCard>
  );
}

function NotificationsSummaryCard({
  t,
  notifications,
}: {
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  notifications: Section<NotificationItem[]>;
}): ReactNode {
  return (
    <SectionCard title={t("dashboard.notifications.title")}>
      {notifications.kind === "loading" ? <SectionMessage text={t("states.loading")} /> : null}
      {notifications.kind === "error" ? <SectionMessage text={t("dashboard.loadFailed")} /> : null}
      {notifications.kind === "ready" && notifications.data.length === 0 ? (
        <SectionMessage text={t("notifications.empty.title")} />
      ) : null}
      {notifications.kind === "ready" && notifications.data.length > 0 ? (
        <>
          <p className="mb-2 text-sm text-muted-foreground">
            {t("dashboard.notifications.unread", { count: notifications.data.length })}
          </p>
          <ul className="flex flex-col gap-2 text-sm">
            {notifications.data.map((item) => (
              <li key={item.id}>
                <p className="font-medium text-foreground">{item.title}</p>
                <p className="text-xs text-muted-foreground">{item.body}</p>
              </li>
            ))}
          </ul>
          <Link
            to="/settings/notifications"
            className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
          >
            {t("notifications.preferences.link")}
          </Link>
        </>
      ) : null}
    </SectionCard>
  );
}
