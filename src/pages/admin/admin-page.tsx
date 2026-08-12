import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FeatureView } from "@/features/access/access-api";
import {
  listCompanies,
  listFeatureCatalog,
  PLAN_CODES,
  setCompanySubscription,
  toggleCompanyFeature,
  type AdminCompany,
} from "@/features/access/admin-api";
import { useI18n } from "@/i18n/i18n-provider";

interface Loaded {
  readonly companies: AdminCompany[];
  readonly nextCursor: string | null;
  readonly features: FeatureView[];
}

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | ({ readonly kind: "ready" } & Loaded);

/**
 * Platform Super-Admin surface: list every company and, with no code change,
 * set its plan or toggle a feature. Changes take effect live (the server
 * invalidates the capability cache). Reached behind {@link RequireSuperAdmin};
 * the API's `SuperAdminGuard` is the real gate.
 */
export function AdminPage(): ReactNode {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [notice, setNotice] = useState<{ companyId: string; text: string } | null>(null);

  const loadFirst = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const [companies, features] = await Promise.all([listCompanies(), listFeatureCatalog()]);
      setState({
        kind: "ready",
        companies: companies.data,
        nextCursor: companies.page.nextCursor,
        features: features.data,
      });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const loadMore = async (): Promise<void> => {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    const next = await listCompanies(state.nextCursor);
    setState({
      ...state,
      companies: [...state.companies, ...next.data],
      nextCursor: next.page.nextCursor,
    });
  };

  const flash = (companyId: string, key: "admin.saved" | "admin.saveFailed"): void => {
    setNotice({ companyId, text: t(key) });
    window.setTimeout(() => setNotice(null), 2500);
  };

  const onSetPlan = async (companyId: string, planCode: string): Promise<void> => {
    try {
      await setCompanySubscription(companyId, planCode);
      if (state.kind === "ready") {
        setState({
          ...state,
          companies: state.companies.map((c) => (c.id === companyId ? { ...c, planCode } : c)),
        });
      }
      flash(companyId, "admin.saved");
    } catch {
      flash(companyId, "admin.saveFailed");
    }
  };

  const onToggleFeature = async (
    companyId: string,
    featureKey: string,
    enabled: boolean,
  ): Promise<void> => {
    try {
      await toggleCompanyFeature(companyId, featureKey, enabled);
      flash(companyId, "admin.saved");
    } catch {
      flash(companyId, "admin.saveFailed");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("admin.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("admin.subtitle")}</p>
      </header>

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={() => void loadFirst()} /> : null}
      {state.kind === "ready" && state.companies.length === 0 ? (
        <EmptyState title={t("admin.empty")} />
      ) : null}

      {state.kind === "ready" && state.companies.length > 0 ? (
        <div className="flex flex-col gap-4">
          {state.companies.map((company) => (
            <Card key={company.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>{company.name}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                    {company.status}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <PlanControl
                  currentPlan={company.planCode}
                  onSet={(plan) => void onSetPlan(company.id, plan)}
                />
                <div>
                  <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                    {t("admin.features")}
                  </p>
                  <ul className="flex flex-col divide-y divide-border">
                    {state.features.map((feature) => (
                      <li
                        key={feature.key}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <span className="text-sm">{feature.name}</span>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void onToggleFeature(company.id, feature.key, true)}
                          >
                            {t("admin.enable")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void onToggleFeature(company.id, feature.key, false)}
                          >
                            {t("admin.disable")}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                {notice?.companyId === company.id ? (
                  <p className="text-sm text-muted-foreground" role="status">
                    {notice.text}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}

          {state.nextCursor !== null ? (
            <Button variant="outline" onClick={() => void loadMore()} className="self-center">
              {t("admin.loadMore")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Plan selector + apply button for one company. */
function PlanControl({
  currentPlan,
  onSet,
}: {
  currentPlan: string | null;
  onSet: (plan: string) => void;
}): ReactNode {
  const { t } = useI18n();
  const [plan, setPlan] = useState(currentPlan ?? PLAN_CODES[0]);

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-muted-foreground" htmlFor="plan">
        {t("admin.plan")}
      </label>
      <select
        id="plan"
        value={plan}
        onChange={(e) => setPlan(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        {PLAN_CODES.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
      <Button size="sm" onClick={() => onSet(plan)}>
        {t("admin.setPlan")}
      </Button>
    </div>
  );
}
