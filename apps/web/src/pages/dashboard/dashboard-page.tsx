import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { FeatureGate } from "@/components/access/feature-gate";
import { PermissionGate } from "@/components/access/permission-gate";
import { StatusBadge } from "@/components/status-badge/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageTitle } from "@/components/layout/page-title";
import { DashboardKpiRow } from "./dashboard-kpi-row";
import { useCapabilities } from "@/features/access/use-capabilities";
import { getBusinessAnalytics, type BusinessSummary } from "@/features/analytics/analytics-api";
import { listStock, type StockLevel } from "@/features/inventory/inventory-api";
import {
  listNotifications,
  type NotificationItem,
} from "@/features/notifications/notifications-api";
import { listOrders, orderStatusCounts, type OrderListItem } from "@/features/orders/orders-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format-money";
import { SalesChart, StatusChart } from "./dashboard-charts";

const RECENT_ORDERS_LIMIT = 5;
const RECENT_ACTIVITY_LIMIT = 6;
const LOW_STOCK_LIMIT = 5;

type Section<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly data: T };

interface LowStock {
  readonly rows: readonly StockLevel[];
  readonly hasMore: boolean;
}

/**
 * The authenticated landing page ("/"). Every widget reuses its module's own
 * `features/*-api.ts` client and permission model — this page fetches and
 * composes, it never re-derives business logic (order lifecycle, low-stock
 * threshold, KPI math already live in the analytics / inventory APIs). A
 * widget whose feature/permission is unavailable, or whose
 * fetch fails, is simply omitted — never backfilled with placeholder data.
 */
export function DashboardPage(): ReactNode {
  const { t, locale } = useI18n();
  const { has } = useCapabilities();

  const [statusCounts, setStatusCounts] = useState<Section<Record<string, number>>>({
    kind: "loading",
  });
  const [sales, setSales] = useState<Section<BusinessSummary>>({ kind: "loading" });
  const [recentOrders, setRecentOrders] = useState<Section<OrderListItem[]>>({ kind: "loading" });
  const [lowStock, setLowStock] = useState<Section<LowStock>>({ kind: "loading" });
  const [notifications, setNotifications] = useState<Section<NotificationItem[]>>({
    kind: "loading",
  });

  const canOrders = has({ feature: "orders" });
  const canInventory = has({ feature: "inventory" });
  const canAnalytics = has({ feature: "analytics", permission: "analytics.read" });
  const canNotifications = has({ feature: "notifications" });

  useEffect(() => {
    if (!canOrders) return;
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
        // Stock rows carry their own product name, so this widget needs no
        // catalog call — and cannot fall back to uuids when one fails.
        const page = await listStock({ belowReorder: true, sort: "available" });
        setLowStock({ kind: "ready", data: { rows: page.data, hasMore: page.page.hasMore } });
      } catch {
        setLowStock({ kind: "error" });
      }
    })();
  }, [canInventory]);

  useEffect(() => {
    if (!canNotifications) return;
    void listNotifications({ read: false, limit: 5 })
      .then((page) => setNotifications({ kind: "ready", data: [...page.data] }))
      .catch(() => setNotifications({ kind: "error" }));
  }, [canNotifications]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 lg:p-6">
      <PageTitle title={t("dashboard.title")} description={t("dashboard.subtitle")} />

      {/* Period-scoped headline figures. Behind the same gates as their sources:
          the money and order counts come from analytics, the per-status figures
          from the orders aggregate, and the API re-checks both (ADR-003). */}
      {canAnalytics && canOrders ? <DashboardKpiRow /> : null}

      <QuickActions t={t} />

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
                {row.productName}
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
