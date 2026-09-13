import {
  ArrowLeft,
  BarChart3,
  Package,
  ShoppingBasket,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { StatCard, StatCardSkeleton } from "@/components/ui/stat-card";
import {
  getProductsAnalytics,
  type AnalyticsWindow,
  type ProductPerformanceRow,
  type ProductsSummary,
} from "@/features/analytics/analytics-api";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";
import { formatMoney, growthPill, MoneyValue, PanelCard } from "./analytics-shared";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly summary: ProductsSummary };

/** Percent change from `previous` to `current`; `null` when there was no baseline. */
function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

/**
 * Product performance for the picked window (`GET /v1/analytics/products`):
 * four headline figures over the two rankings — best and worst sellers by
 * revenue. Cancelled and returned orders count towards none of it.
 */
export function ProductsTab({ window: win }: { readonly window: AnalyticsWindow }): ReactNode {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const summary = await getProductsAnalytics(win);
        if (!cancelled) setState({ kind: "ready", summary });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [win]);

  if (state.kind === "error") {
    return <p className="text-sm text-muted-foreground">{t("analytics.loadFailed")}</p>;
  }

  const summary = state.kind === "ready" ? state.summary : null;

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <ProductStats summary={summary} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
        <RankedPanel
          rows={summary === null ? null : summary.top}
          title={t("analytics.products.top")}
          hint={t("analytics.products.topHint")}
          tone="top"
        />
        <RankedPanel
          rows={summary === null ? null : summary.bottom}
          title={t("analytics.products.bottom")}
          hint={t("analytics.products.bottomHint")}
          tone="bottom"
        />
      </div>
    </div>
  );
}

/** The four headline figures, each (bar the catalogue count) against the preceding window. */
function ProductStats({ summary }: { readonly summary: ProductsSummary | null }): ReactNode {
  const { t, locale } = useI18n();
  const unit = t("analytics.currency");

  if (summary === null) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" aria-busy="true">
        {[0, 1, 2, 3].map((index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  const { totals, previous } = summary;
  const vsPrevious = t("analytics.vsPrevious");

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      <StatCard
        tone="primary"
        icon={Package}
        label={t("analytics.products.totalProducts")}
        value={totals.activeProducts.toLocaleString(locale)}
        hint={t("analytics.products.newInPeriod", {
          count: totals.newProducts.toLocaleString(locale),
        })}
      />
      <StatCard
        tone="info"
        icon={ShoppingBasket}
        label={t("analytics.products.unitsSold")}
        value={totals.unitsSold.toLocaleString(locale)}
        pill={growthPill(percentChange(totals.unitsSold, previous.unitsSold), locale)}
        hint={vsPrevious}
      />
      <StatCard
        tone="success"
        icon={BarChart3}
        label={t("analytics.products.totalRevenue")}
        value={<MoneyValue minor={totals.revenueMinor} locale={locale} unit={unit} />}
        pill={growthPill(percentChange(totals.revenueMinor, previous.revenueMinor), locale)}
        hint={vsPrevious}
      />
      <StatCard
        tone="violet"
        icon={TrendingUp}
        label={t("analytics.products.averagePrice")}
        value={<MoneyValue minor={totals.averagePriceMinor} locale={locale} unit={unit} />}
        pill={growthPill(
          percentChange(totals.averagePriceMinor, previous.averagePriceMinor),
          locale,
        )}
        hint={vsPrevious}
      />
    </div>
  );
}

const PANEL_TONES = {
  top: {
    header: "bg-success/8",
    icon: "bg-success/12 text-success",
    badge: "bg-success/12 text-success",
    Icon: TrendingUp,
  },
  bottom: {
    header: "bg-destructive/8",
    icon: "bg-destructive/12 text-destructive",
    badge: "bg-destructive/12 text-destructive",
    Icon: TrendingDown,
  },
} as const;

/**
 * One ranking. From `lg` it is an ordinary table; on a phone the same rows
 * wrap into two lines each, because five columns will not fit a phone.
 */
function RankedPanel({
  rows,
  title,
  hint,
  tone,
}: {
  readonly rows: readonly ProductPerformanceRow[] | null;
  readonly title: string;
  readonly hint: string;
  readonly tone: "top" | "bottom";
}): ReactNode {
  const { t, locale } = useI18n();
  const style = PANEL_TONES[tone];
  const Icon = style.Icon;

  return (
    <PanelCard
      title={title}
      hint={hint}
      headerClassName={style.header}
      icon={
        <span
          aria-hidden="true"
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            style.icon,
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
      }
      actions={
        rows === null ? null : (
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums",
              style.badge,
            )}
          >
            {t("analytics.products.count", { count: rows.length.toLocaleString(locale) })}
          </span>
        )
      }
      footer={
        <div className="border-t border-border px-4 py-3 lg:px-5">
          <Link
            to="/products"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("analytics.products.viewAll")}
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </Link>
        </div>
      }
    >
      {rows === null ? (
        <div className="h-56 animate-pulse rounded-xl bg-muted" aria-busy="true" />
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t("analytics.products.empty")}
        </p>
      ) : (
        <ProductRows rows={rows} locale={locale} />
      )}
    </PanelCard>
  );
}

function ProductRows({
  rows,
  locale,
}: {
  readonly rows: readonly ProductPerformanceRow[];
  readonly locale: string;
}): ReactNode {
  const { t } = useI18n();

  return (
    <table className="w-full text-sm">
      <thead className="hidden lg:table-header-group">
        <tr className="text-xs text-muted-foreground">
          <th scope="col" className="w-10 py-2 text-start font-medium">
            #
          </th>
          <th scope="col" className="py-2 text-start font-medium">
            {t("analytics.products.product")}
          </th>
          <th scope="col" className="py-2 text-end font-medium">
            {t("analytics.products.unitsSold")}
          </th>
          <th scope="col" className="whitespace-nowrap py-2 text-end font-medium">
            {t("analytics.products.revenueWithUnit", { unit: t("analytics.currency") })}
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((row, index) => (
          <tr
            key={row.variantId}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 lg:table-row lg:py-0"
          >
            <td className="shrink-0 tabular-nums text-muted-foreground lg:py-2.5">
              {(index + 1).toLocaleString(locale)}
            </td>
            <td className="flex min-w-0 flex-1 items-center gap-2.5 lg:table-cell lg:py-2.5">
              <span className="flex min-w-0 items-center gap-2.5">
                <ProductThumb row={row} />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">
                    {row.productName}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.variantName}
                  </span>
                </span>
              </span>
            </td>
            <td className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground lg:py-2.5 lg:text-end lg:text-sm lg:text-foreground">
              <span className="lg:hidden">{t("analytics.products.unitsShort")} </span>
              {row.unitsSold.toLocaleString(locale)}
            </td>
            <td className="ms-auto shrink-0 whitespace-nowrap font-semibold tabular-nums lg:ms-0 lg:py-2.5 lg:text-end lg:font-normal">
              {formatMoney(row.revenueMinor, locale)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The product's image, or its first letter when it has none. */
function ProductThumb({ row }: { readonly row: ProductPerformanceRow }): ReactNode {
  if (row.imageUrl === null || row.imageUrl.length === 0) {
    return (
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground"
      >
        {row.productName.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      src={row.imageUrl}
      alt=""
      loading="lazy"
      className="h-9 w-9 shrink-0 rounded-lg border border-border object-cover"
    />
  );
}
