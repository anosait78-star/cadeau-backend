import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getProfitabilityAnalytics,
  type AnalyticsWindow,
  type ProfitabilityPeriod,
  type ProfitabilitySummary,
} from "@/features/analytics/analytics-api";
import { useI18n } from "@/i18n/i18n-provider";
import { formatDeltaPct, formatMoney, Stat } from "./analytics-shared";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly summary: ProfitabilitySummary };

/** Net income on collected − COGS − expenses (`GET /v1/analytics/profitability`, D4). */
export function ProfitabilityTab({ window: win }: { window: AnalyticsWindow }): ReactNode {
  const { t, locale } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const summary = await getProfitabilityAnalytics(win);
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
        <CardTitle className="text-base">{t("analytics.tab.profitability")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <PeriodStats period={summary.current} locale={locale} />
        <Stat
          label={t("analytics.profitability.delta")}
          value={formatDeltaPct(summary.netIncomeDeltaPct, locale)}
        />
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            {t("analytics.profitability.previous")}
          </h3>
          <PeriodStats period={summary.previous} locale={locale} />
        </div>
      </CardContent>
    </Card>
  );
}

function PeriodStats({
  period,
  locale,
}: {
  period: ProfitabilityPeriod;
  locale: string;
}): ReactNode {
  const { t } = useI18n();
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
      <Stat
        label={t("analytics.profitability.collected")}
        value={formatMoney(period.collectedMinor, locale)}
      />
      <Stat
        label={t("analytics.profitability.cogs")}
        value={formatMoney(period.cogsMinor, locale)}
      />
      <Stat
        label={t("analytics.profitability.expenses")}
        value={formatMoney(period.expensesMinor, locale)}
      />
      <Stat
        label={t("analytics.profitability.netIncome")}
        value={formatMoney(period.netIncomeMinor, locale)}
        emphasize
      />
    </dl>
  );
}
