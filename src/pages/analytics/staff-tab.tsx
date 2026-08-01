import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getStaffAnalytics,
  type AnalyticsWindow,
  type StaffSummary,
} from "@/features/analytics/analytics-api";
import { useI18n } from "@/i18n/i18n-provider";
import { formatMoney } from "./analytics-shared";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly summary: StaffSummary };

/** Per-assignee performance (`GET /v1/analytics/staff`). */
export function StaffTab({ window: win }: { window: AnalyticsWindow }): ReactNode {
  const { t, locale } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const summary = await getStaffAnalytics(win);
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
        <CardTitle className="text-base">{t("analytics.tab.staff")}</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-start text-xs text-muted-foreground">
              <th className="text-start font-medium">{t("analytics.staff.assignee")}</th>
              <th className="text-end font-medium">{t("analytics.staff.orderCount")}</th>
              <th className="text-end font-medium">{t("analytics.staff.collected")}</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <tr key={row.assigneeId ?? "unassigned"}>
                <td className="py-1">{row.assigneeName}</td>
                <td className="py-1 text-end tabular-nums">{row.orderCount}</td>
                <td className="py-1 text-end tabular-nums">
                  {formatMoney(row.collectedMinor, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
