import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { FeatureGate } from "@/components/access/feature-gate";
import { EmptyState } from "@/components/states/empty-state";
import { useToast } from "@/components/toast/toast";
import { Button } from "@/components/ui/button";
import { listSuppliers } from "@/features/finance/finance-api";
import { listProducts, listVariants } from "@/features/products/products-api";
import { listWarehouses } from "@/features/inventory/inventory-api";
import { useI18n } from "@/i18n/i18n-provider";
import type { TranslationKey } from "@/i18n/dictionaries";
import { ExpensesTab } from "./expenses-tab";
import type { Option } from "./finance-shared";
import { InvoicesTab } from "./invoices-tab";
import { PeriodsTab } from "./periods-tab";
import { PurchaseOrdersTab } from "./purchase-orders-tab";
import { ReconciliationsTab } from "./reconciliations-tab";
import { RefundsTab } from "./refunds-tab";
import { ReportsTab } from "./reports-tab";
import { SuppliersTab } from "./suppliers-tab";

type Tab =
  | "suppliers"
  | "purchaseOrders"
  | "expenses"
  | "invoices"
  | "refunds"
  | "reconciliations"
  | "periods"
  | "reports";

const TABS: readonly Tab[] = [
  "suppliers",
  "purchaseOrders",
  "expenses",
  "invoices",
  "refunds",
  "reconciliations",
  "periods",
  "reports",
];

/**
 * Finance — suppliers & purchase orders, expenses, invoices (with PDF), refunds,
 * shipping reconciliation, accounting-period close, and the cash-center/P&L
 * dashboard (EPIC-13). The whole page is behind the `finance` feature; every
 * write is behind `finance.manage` (the API re-checks both — ADR-003). Tabs
 * mirror the inventory page's convention for a multi-resource module: one
 * responsive card list per resource (the card alternative required by
 * ADR-002), ar/en throughout.
 */
export function FinancePage(): ReactNode {
  const { t } = useI18n();
  return (
    <FeatureGate
      feature="finance"
      fallback={
        <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
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
  const [tab, setTab] = useState<Tab>("suppliers");
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [variants, setVariants] = useState<Option[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);

  const flash = useCallback((text: string): void => toast.show(text), [toast]);

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
        const page = await listWarehouses({ active: true });
        if (!cancelled) setWarehouses(page.data.map((w) => ({ id: w.id, name: w.name })));
      } catch {
        if (!cancelled) setWarehouses([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("finance.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("finance.subtitle")}</p>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("finance.title")}>
        {TABS.map((key) => (
          <Button
            key={key}
            role="tab"
            aria-selected={tab === key}
            variant={tab === key ? "primary" : "outline"}
            size="sm"
            onClick={() => setTab(key)}
          >
            {t(`finance.tab.${key}` as TranslationKey)}
          </Button>
        ))}
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
      {tab === "invoices" ? <InvoicesTab onNotify={flash} /> : null}
      {tab === "refunds" ? <RefundsTab onNotify={flash} /> : null}
      {tab === "reconciliations" ? <ReconciliationsTab onNotify={flash} /> : null}
      {tab === "periods" ? <PeriodsTab onNotify={flash} /> : null}
      {tab === "reports" ? <ReportsTab onNotify={flash} /> : null}
    </div>
  );
}
