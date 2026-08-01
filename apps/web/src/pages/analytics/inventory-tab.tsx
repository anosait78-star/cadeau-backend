import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getInventoryAnalytics,
  type AnalyticsWindow,
  type InventorySummary,
} from "@/features/analytics/analytics-api";
import { useI18n } from "@/i18n/i18n-provider";
import { formatMoney, Stat } from "./analytics-shared";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly summary: InventorySummary };

/** Stock health summary (`GET /v1/analytics/inventory`). */
export function InventoryTab({ window: win }: { window: AnalyticsWindow }): ReactNode {
  const { t, locale } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const summary = await getInventoryAnalytics(win);
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("analytics.tab.inventory")}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <Stat
            label={t("analytics.inventory.onHandValue")}
            value={formatMoney(summary.onHandValueMinor, locale)}
            emphasize
          />
          <Stat label={t("analytics.inventory.lowStock")} value={String(summary.lowStockCount)} />
          <Stat
            label={t("analytics.inventory.outOfStock")}
            value={String(summary.outOfStockCount)}
          />
          <Stat
            label={t("analytics.inventory.turnover")}
            value={
              summary.turnoverSignal === null
                ? "—"
                : summary.turnoverSignal.toLocaleString(locale, { maximumFractionDigits: 2 })
            }
          />
        </dl>
      </CardContent>
    </Card>
  );
}
