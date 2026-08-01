import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { FeatureGate } from "@/components/access/feature-gate";
import { EmptyState } from "@/components/states/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  exportAnalytics,
  type AnalyticsAxis,
  type AnalyticsWindow,
} from "@/features/analytics/analytics-api";
import { useI18n } from "@/i18n/i18n-provider";
import type { TranslationKey } from "@/i18n/dictionaries";
import { BusinessTab } from "./business-tab";
import { Field } from "./analytics-shared";
import { InventoryTab } from "./inventory-tab";
import { ProductsTab } from "./products-tab";
import { ProfitabilityTab } from "./profitability-tab";
import { StaffTab } from "./staff-tab";

type Tab = AnalyticsAxis;

const TABS: readonly Tab[] = ["business", "products", "inventory", "staff", "profitability"];

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Analytics — five computed, read-only views over the business (EPIC-14):
 * business KPIs, product performance, inventory health, staff performance,
 * and net income on collected. The whole page is behind the `analytics`
 * feature (`analytics.read`); export is additionally behind
 * `analytics.manage` (D1) — the API re-checks both (ADR-003). Tabs mirror
 * the finance page's convention for a multi-view module, ar/en throughout.
 */
export function AnalyticsPage(): ReactNode {
  const { t } = useI18n();
  return (
    <FeatureGate
      feature="analytics"
      fallback={
        <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
          <EmptyState title={t("analytics.forbidden")} />
        </div>
      }
    >
      <AnalyticsScreen />
    </FeatureGate>
  );
}

function AnalyticsScreen(): ReactNode {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("business");
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());
  const [granularity, setGranularity] = useState<"day" | "week" | "month">("day");
  const [notice, setNotice] = useState<string | null>(null);

  const flash = useCallback((text: string): void => {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 2500);
  }, []);

  const win: AnalyticsWindow = {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    granularity,
  };

  const handleExport = async (): Promise<void> => {
    try {
      await exportAnalytics(tab, win);
      flash(t("analytics.export.done"));
    } catch {
      flash(t("analytics.export.failed"));
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("analytics.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("analytics.subtitle")}</p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <Field id="analytics-from" label={t("analytics.window.from")}>
          <Input
            id="analytics-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label={t("analytics.window.from")}
          />
        </Field>
        <Field id="analytics-to" label={t("analytics.window.to")}>
          <Input
            id="analytics-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label={t("analytics.window.to")}
          />
        </Field>
        <Field id="analytics-granularity" label={t("analytics.window.granularity")}>
          <select
            id="analytics-granularity"
            aria-label={t("analytics.window.granularity")}
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as "day" | "week" | "month")}
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="day">{t("analytics.window.granularity.day")}</option>
            <option value="week">{t("analytics.window.granularity.week")}</option>
            <option value="month">{t("analytics.window.granularity.month")}</option>
          </select>
        </Field>
        <Button variant="outline" onClick={() => void handleExport()}>
          {t("analytics.actions.export")}
        </Button>
      </div>

      {notice !== null ? (
        <p className="text-sm text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("analytics.title")}>
        {TABS.map((key) => (
          <Button
            key={key}
            role="tab"
            aria-selected={tab === key}
            variant={tab === key ? "primary" : "outline"}
            size="sm"
            onClick={() => setTab(key)}
          >
            {t(`analytics.tab.${key}` as TranslationKey)}
          </Button>
        ))}
      </div>

      {tab === "business" ? <BusinessTab window={win} /> : null}
      {tab === "products" ? <ProductsTab window={win} /> : null}
      {tab === "inventory" ? <InventoryTab window={win} /> : null}
      {tab === "staff" ? <StaffTab window={win} /> : null}
      {tab === "profitability" ? <ProfitabilityTab window={win} /> : null}
    </div>
  );
}
