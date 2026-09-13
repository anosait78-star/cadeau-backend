import { BarChart3, ChevronRight, ShoppingCart, UsersRound, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { FeatureGate } from "@/components/access/feature-gate";
import { EmptyState } from "@/components/states/empty-state";
import { useToast } from "@/components/toast/toast";
import { listSuppliers } from "@/features/finance/finance-api";
import { listProducts, listVariants } from "@/features/products/products-api";
import { listWarehouses } from "@/features/inventory/inventory-api";
import { useI18n } from "@/i18n/i18n-provider";
import type { TranslationKey } from "@/i18n/dictionaries";
import { cn } from "@/lib/cn";
import { ExpensesTab } from "./expenses-tab";
import type { Option } from "./finance-shared";
import { PurchaseOrdersTab } from "./purchase-orders-tab";
import { ReportsTab } from "./reports-tab";
import { SuppliersTab } from "./suppliers-tab";

type Tab = "expenses" | "purchaseOrders" | "reports" | "suppliers";

/** In display order; the first is the default. */
const TABS: readonly Tab[] = ["expenses", "purchaseOrders", "reports", "suppliers"];

const TAB_ICONS: Readonly<Record<Tab, LucideIcon>> = {
  expenses: Wallet,
  purchaseOrders: ShoppingCart,
  reports: BarChart3,
  suppliers: UsersRound,
};

/** The open tab lives in `?tab=`, so a refresh or a shared link reopens it. */
function parseTab(value: string | null): Tab {
  return TABS.find((key) => key === value) ?? "expenses";
}

/**
 * Finance (EPIC-13): expenses, purchase orders, the cash center & P&L, and
 * the suppliers purchase orders are raised against.
 *
 * Invoices, refunds, shipping reconciliation and accounting periods were
 * taken off this page; their API endpoints remain, since the finance service
 * still relies on them (a closed period blocks expense and purchase-order
 * writes, and refunds feed the cash center). The whole page is behind the `finance` feature; every
 * write is behind `finance.manage` (the API re-checks both — ADR-003).
 *
 * Desktop opens on a banner (breadcrumb, title, subtitle) above a row of icon
 * tabs. A phone drops the banner — its shell already titles the page — and
 * the tabs become one row that scrolls sideways, edge to edge.
 */
export function FinancePage(): ReactNode {
  const { t } = useI18n();
  return (
    <FeatureGate
      feature="finance"
      fallback={
        <div className="mx-auto w-full max-w-5xl lg:p-6">
          <EmptyState title={t("finance.forbidden")} />
        </div>
      }
    >
      <FinanceScreen />
    </FeatureGate>
  );
}

function FinanceScreen(): ReactNode {
  const { t } = useI18n();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [variants, setVariants] = useState<Option[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);

  const flash = useCallback((text: string): void => toast.show(text), [toast]);

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

  const loadSuppliers = useCallback(async (): Promise<void> => {
    try {
      const page = await listSuppliers({ active: true });
      setSuppliers(page.data.map((s) => ({ id: s.id, name: s.name })));
    } catch {
      setSuppliers([]);
    }
  }, []);

  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

  // Best-effort: variant names for PO lines, warehouse names for receipts.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const products = await listProducts({ active: true });
        const lists = await Promise.all(
          products.data.map(async (product) => {
            const res = await listVariants(product.id);
            return res.data.map((v) => ({ id: v.id, name: `${product.name} — ${v.name}` }));
          }),
        );
        if (!cancelled) setVariants(lists.flat());
      } catch {
        if (!cancelled) setVariants([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const warehouses = await listWarehouses({ active: true });
        if (!cancelled) setWarehouses(warehouses.map((w) => ({ id: w.id, name: w.name })));
      } catch {
        if (!cancelled) setWarehouses([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 lg:gap-6 lg:p-6">
      <FinanceHero />

      <div
        role="tablist"
        aria-label={t("finance.title")}
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0"
      >
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
                "inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border px-3.5 text-sm font-medium shadow-xs transition-colors lg:px-4",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:border-primary/40 hover:text-primary",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t(`finance.tab.${key}` as TranslationKey)}
            </button>
          );
        })}
      </div>

      {tab === "suppliers" ? (
        <SuppliersTab
          onNotify={(text) => {
            flash(text);
            void loadSuppliers();
          }}
        />
      ) : null}
      {tab === "purchaseOrders" ? (
        <PurchaseOrdersTab
          suppliers={suppliers}
          variants={variants}
          warehouses={warehouses}
          onNotify={flash}
        />
      ) : null}
      {tab === "expenses" ? <ExpensesTab suppliers={suppliers} onNotify={flash} /> : null}
      {tab === "reports" ? <ReportsTab onNotify={flash} /> : null}
    </div>
  );
}

/** Desktop banner: breadcrumb, title and subtitle over a soft brand wash. */
function FinanceHero(): ReactNode {
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
            <Wallet className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <nav aria-label={t("finance.hero.breadcrumb")}>
              <ol className="flex items-center gap-1 text-xs text-muted-foreground">
                <li>
                  <Link to="/" className="transition-colors hover:text-foreground">
                    {t("finance.hero.home")}
                  </Link>
                </li>
                <li aria-hidden="true">
                  <ChevronRight className="h-3 w-3 rtl:rotate-180" />
                </li>
                <li aria-current="page" className="font-medium text-foreground">
                  {t("finance.title")}
                </li>
              </ol>
            </nav>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">
              {t("finance.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("finance.subtitle")}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-border/60 bg-card/80 px-4 py-3 shadow-sm backdrop-blur">
          <div>
            <p className="text-sm font-semibold text-foreground">{t("finance.hero.badgeTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("finance.hero.badgeHint")}</p>
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
