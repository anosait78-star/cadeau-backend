import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getProductsAnalytics,
  type AnalyticsWindow,
  type ProductPerformanceRow,
  type ProductsSummary,
} from "@/features/analytics/analytics-api";
import { useI18n } from "@/i18n/i18n-provider";
import { formatMoney } from "./analytics-shared";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly summary: ProductsSummary };

/** Top/bottom product performance (`GET /v1/analytics/products`). */
export function ProductsTab({ window: win }: { window: AnalyticsWindow }): ReactNode {
  const { t, locale } = useI18n();
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

  if (state.kind === "loading") return null;
  if (state.kind === "error") {
    return <p className="text-sm text-muted-foreground">{t("analytics.loadFailed")}</p>;
  }

  const { summary } = state;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <RankedTable title={t("analytics.products.top")} rows={summary.top} locale={locale} />
      <RankedTable title={t("analytics.products.bottom")} rows={summary.bottom} locale={locale} />
    </div>
  );
}

function RankedTable({
  title,
  rows,
  locale,
}: {
  title: string;
  rows: readonly ProductPerformanceRow[];
  locale: string;
}): ReactNode {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-start text-xs text-muted-foreground">
              <th className="text-start font-medium" />
              <th className="text-end font-medium">{t("analytics.products.unitsSold")}</th>
              <th className="text-end font-medium">{t("analytics.products.revenue")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.variantId}>
                <td className="py-1">
                  {row.productName} — {row.variantName}
                </td>
                <td className="py-1 text-end tabular-nums">{row.unitsSold}</td>
                <td className="py-1 text-end tabular-nums">
                  {formatMoney(row.revenueMinor, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
