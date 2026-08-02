import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { PermissionGate } from "@/components/access/permission-gate";
import { ConfirmDialog } from "@/components/confirm-dialog/confirm-dialog";
import { StatusBadge } from "@/components/status-badge/status-badge";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { closePeriod, listPeriods, type AccountingPeriod } from "@/features/finance/finance-api";
import { useI18n } from "@/i18n/i18n-provider";
import { DASH, formatDate } from "./finance-shared";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly items: AccountingPeriod[] };

/** Accounting periods — atomic sequential monthly close (D4), with an explicit confirm step. */
export function PeriodsTab({ onNotify }: { onNotify: (text: string) => void }): ReactNode {
  const { t, locale } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const items = await listPeriods();
      setState({ kind: "ready", items });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const doClose = async (periodKey: string): Promise<void> => {
    try {
      await closePeriod(periodKey);
      onNotify(t("finance.saved"));
      await load();
    } catch {
      onNotify(t("finance.saveFailed"));
      throw new Error("finance.periods.closeFailed");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}
      {state.kind === "ready" && state.items.length === 0 ? (
        <EmptyState title={t("finance.periods.empty")} />
      ) : null}

      {state.kind === "ready" && state.items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {state.items.map((period) => (
            <li key={period.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <span>{period.periodKey}</span>
                    <StatusBadge
                      label={
                        period.status === "closed"
                          ? t("finance.periods.status.closed")
                          : t("finance.periods.status.open")
                      }
                      tone={period.status === "closed" ? "neutral" : "success"}
                    />
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <div className="flex flex-col">
                      <dt className="text-xs text-muted-foreground">
                        {t("finance.periods.field.closedAt")}
                      </dt>
                      <dd>{formatDate(period.closedAt, locale)}</dd>
                    </div>
                    <div className="flex flex-col">
                      <dt className="text-xs text-muted-foreground">
                        {t("finance.periods.field.closedBy")}
                      </dt>
                      <dd>{period.closedBy ?? DASH}</dd>
                    </div>
                  </dl>

                  {period.status === "open" ? (
                    <PermissionGate permission="finance.manage">
                      <div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirmingKey(period.periodKey)}
                        >
                          {t("finance.periods.actions.close")}
                        </Button>
                      </div>
                      <ConfirmDialog
                        open={confirmingKey === period.periodKey}
                        onOpenChange={(open) => setConfirmingKey(open ? period.periodKey : null)}
                        title={t("finance.periods.actions.close")}
                        description={t("finance.periods.confirmClose")}
                        confirmLabel={t("finance.periods.confirmCloseYes")}
                        cancelLabel={t("finance.periods.confirmCloseNo")}
                        destructive
                        onConfirm={() => doClose(period.periodKey)}
                      />
                    </PermissionGate>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
