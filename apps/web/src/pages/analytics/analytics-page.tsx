import { BarChart3, ChevronRight, Download, LineChart, Package } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { FeatureGate } from "@/components/access/feature-gate";
import { PermissionGate } from "@/components/access/permission-gate";
import { EmptyState } from "@/components/states/empty-state";
import { useToast } from "@/components/toast/toast";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { exportAnalytics, type AnalyticsWindow } from "@/features/analytics/analytics-api";
import { useI18n } from "@/i18n/i18n-provider";
import type { TranslationKey } from "@/i18n/dictionaries";
import { cn } from "@/lib/cn";
import { ProductsTab } from "./products-tab";
import { ProfitabilityTab } from "./profitability-tab";

/** The two axes this page shows. The first is the default. */
type Tab = "products" | "profitability";

const TABS: readonly Tab[] = ["products", "profitability"];

const TAB_ICONS: Readonly<Record<Tab, LucideIcon>> = {
  products: Package,
  profitability: LineChart,
};

type Granularity = "day" | "week" | "month";

const GRANULARITIES: readonly Granularity[] = ["day", "week", "month"];

/** The open tab lives in `?tab=`, so a refresh or a shared link reopens it. */
function parseTab(value: string | null): Tab {
  return TABS.find((key) => key === value) ?? "products";
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The window the API is asked for, as an inclusive span of whole days. Both
 * pickers hand back a bare `YYYY-MM-DD`; the end of the window has to be that
 * day's last instant, not its first, or the day the user picked — today, by
 * default — is cut out of the window entirely and everything collected or
 * sold during it goes missing from both tabs.
 */
function dayStart(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function dayEnd(date: string): string {
  return `${date}T23:59:59.999Z`;
}

/**
 * Analytics (EPIC-14): two computed, read-only views over the business —
 * product performance and net income on collected. Both read the same window
 * from one toolbar, defaulting to the last 30 days.
 *
 * The whole page is behind the `analytics` feature (`analytics.read`); export
 * is additionally behind `analytics.manage` (D1) — the API re-checks both
 * (ADR-003). The business, inventory and staff axes were taken off this page;
 * `GET /v1/analytics/business` remains, since the dashboard reads it.
 *
 * Desktop opens on a banner (breadcrumb, title, subtitle) with a toolbar
 * under it. A phone drops the banner — its shell already titles the page —
 * and the tabs become two buttons sharing the width.
 */
export function AnalyticsPage(): ReactNode {
  const { t } = useI18n();
  return (
    <FeatureGate
      feature="analytics"
      fallback={
        <div className="mx-auto w-full max-w-5xl lg:p-6">
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
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());
  const [granularity, setGranularity] = useState<Granularity>("day");

  const changeTab = (next: Tab): void => {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        params.set("tab", next);
        return params;
      },
      { replace: true },
    );
  };

  /*
   * Both tabs refetch whenever this object's identity changes, so it is
   * memoized on the values themselves — otherwise every render of this screen
   * would start a new request.
   */
  const win: AnalyticsWindow = useMemo(
    () => ({
      from: dayStart(from),
      to: dayEnd(to),
      granularity,
    }),
    [from, to, granularity],
  );

  const handleExport = useCallback(async (): Promise<void> => {
    try {
      await exportAnalytics(tab, win);
      toast.show(t("analytics.export.done"));
    } catch {
      toast.show(t("analytics.export.failed"));
    }
  }, [tab, win, toast, t]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 lg:gap-6 lg:p-6">
      <AnalyticsHero tab={tab} />

      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between lg:gap-4">
        <div role="tablist" aria-label={t("analytics.title")} className="flex gap-2">
          {TABS.map((key) => {
            const Icon = TAB_ICONS[key];
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => changeTab(key)}
                className={cn(
                  "inline-flex h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl border px-3.5 text-sm font-medium shadow-xs transition-colors lg:flex-none lg:px-5",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:border-primary/40 hover:text-primary",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t(`analytics.tab.${key}` as TranslationKey)}
              </button>
            );
          })}
        </div>

        {/*
          Two columns on a phone — the dates on one row, then the grouping and
          the export button — because sharing a single row left each date
          picker about sixty pixels wide, with the date spilling out of it.
          From lg there is room for all four side by side.
        */}
        <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-wrap lg:items-end lg:gap-3">
          <Field id="analytics-from" label={t("analytics.window.from")}>
            <DatePicker
              id="analytics-from"
              value={from.length > 0 ? from : null}
              onChange={(next) => setFrom(next ?? "")}
              ariaLabel={t("analytics.window.from")}
            />
          </Field>
          <Field id="analytics-to" label={t("analytics.window.to")}>
            <DatePicker
              id="analytics-to"
              value={to.length > 0 ? to : null}
              onChange={(next) => setTo(next ?? "")}
              ariaLabel={t("analytics.window.to")}
            />
          </Field>
          <Field id="analytics-granularity" label={t("analytics.window.granularity")}>
            <select
              id="analytics-granularity"
              aria-label={t("analytics.window.granularity")}
              value={granularity}
              onChange={(event) => setGranularity(event.target.value as Granularity)}
              className="h-10 w-full rounded-lg border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-auto"
            >
              {GRANULARITIES.map((value) => (
                <option key={value} value={value}>
                  {t(`analytics.window.granularity.${value}` as TranslationKey)}
                </option>
              ))}
            </select>
          </Field>
          <PermissionGate permission="analytics.manage">
            <Button
              className="h-10 w-full gap-2 self-end lg:w-auto lg:shrink-0"
              onClick={() => void handleExport()}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {t("analytics.actions.export")}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {tab === "products" ? <ProductsTab window={win} /> : null}
      {tab === "profitability" ? <ProfitabilityTab window={win} /> : null}
    </div>
  );
}

/** A labeled toolbar control. */
function Field({
  id,
  label,
  className,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

/**
 * Desktop banner: breadcrumb, title and subtitle over a soft brand wash, with
 * a badge whose wording follows the open tab. Matches the finance page's
 * banner, which this page sits beside in the sidebar.
 */
function AnalyticsHero({ tab }: { readonly tab: Tab }): ReactNode {
  const { t } = useI18n();
  return (
    <header className="relative hidden overflow-hidden rounded-2xl border border-border bg-card px-6 py-5 shadow-xs lg:block">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 from-primary/15 via-primary/5 to-transparent ltr:bg-gradient-to-l rtl:bg-gradient-to-r"
      />
      <div className="relative flex items-center justify-between gap-6">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md"
          >
            <BarChart3 className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <nav aria-label={t("analytics.hero.breadcrumb")}>
              <ol className="flex items-center gap-1 text-xs text-muted-foreground">
                <li>
                  <Link to="/" className="transition-colors hover:text-foreground">
                    {t("analytics.hero.home")}
                  </Link>
                </li>
                <li aria-hidden="true">
                  <ChevronRight className="h-3 w-3 rtl:rotate-180" />
                </li>
                <li aria-current="page" className="font-medium text-foreground">
                  {t("analytics.title")}
                </li>
              </ol>
            </nav>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">
              {t(`analytics.hero.title.${tab}` as TranslationKey)}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(`analytics.hero.subtitle.${tab}` as TranslationKey)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-border/60 bg-card/80 px-4 py-3 shadow-sm backdrop-blur">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {t(`analytics.hero.badgeTitle.${tab}` as TranslationKey)}
            </p>
            <p className="text-xs text-muted-foreground">{t("analytics.hero.badgeHint")}</p>
          </div>
          <span
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary"
          >
            <BarChart3 className="h-6 w-6" />
          </span>
        </div>
      </div>
    </header>
  );
}
