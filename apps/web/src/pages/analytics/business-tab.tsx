import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getBusinessAnalytics,
  type AnalyticsWindow,
  type BusinessSummary,
} from "@/features/analytics/analytics-api";
import { useI18n } from "@/i18n/i18n-provider";
import { formatDeltaPct, formatMoney, Sparkline, Stat } from "./analytics-shared";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly summary: BusinessSummary };

/** Business KPIs + deltas + sparkline (`GET /v1/analytics/business`). */
export function BusinessTab({ window: win }: { window: AnalyticsWindow }): ReactNode {
  const { t, locale } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const summary = await getBusinessAnalytics(win);
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
        <CardTitle className="text-base">{t("analytics.tab.business")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <Stat label={t("analytics.business.orderCount")} value={String(summary.orderCount)} />
          <Stat
            label={t("analytics.business.collected")}
            value={formatMoney(summary.collectedMinor, locale)}
          />
          <Stat
            label={t("analytics.business.averageOrderValue")}
            value={formatMoney(summary.averageOrderValueMinor, locale)}
          />
          <Stat
            label={t("analytics.business.orderCountDelta")}
            value={formatDeltaPct(summary.orderCountDeltaPct, locale)}
          />
          <Stat
            label={t("analytics.business.collectedDelta")}
            value={formatDeltaPct(summary.collectedDeltaPct, locale)}
          />
        </dl>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">{t("analytics.business.series")}</p>
          <Sparkline points={summary.series} />
        </div>
      </CardContent>
    </Card>
  );
}
