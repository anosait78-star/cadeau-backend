import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { PermissionGate } from "@/components/access/permission-gate";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createReconciliation,
  listReconciliations,
  newIdempotencyKey,
  type CreateReconciliationLineInput,
  type ReconciliationListItem,
} from "@/features/finance/finance-api";
import { useI18n } from "@/i18n/i18n-provider";
import { Field, formatMoney } from "./finance-shared";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | {
      readonly kind: "ready";
      readonly items: ReconciliationListItem[];
      readonly nextCursor: string | null;
    };

/** Shipping reconciliation — match a carrier statement to shipments by tracking number (D5). */
export function ReconciliationsTab({ onNotify }: { onNotify: (text: string) => void }): ReactNode {
  const { t, locale } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const page = await listReconciliations();
      setState({ kind: "ready", items: page.data, nextCursor: page.page.nextCursor });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async (): Promise<void> => {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    const page = await listReconciliations({ cursor: state.nextCursor });
    setState({
      kind: "ready",
      items: [...state.items, ...page.data],
      nextCursor: page.page.nextCursor,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <PermissionGate permission="finance.manage">
        {creating ? null : (
          <div>
            <Button onClick={() => setCreating(true)}>{t("finance.actions.create")}</Button>
          </div>
        )}
      </PermissionGate>

      {creating ? (
        <PermissionGate permission="finance.manage">
          <ReconciliationForm
            onDone={async (message) => {
              onNotify(message);
              setCreating(false);
              await load();
            }}
            onFail={() => onNotify(t("finance.saveFailed"))}
            onCancel={() => setCreating(false)}
          />
        </PermissionGate>
      ) : null}

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}
      {state.kind === "ready" && state.items.length === 0 ? (
        <EmptyState title={t("finance.reconciliations.empty")} />
      ) : null}

      {state.kind === "ready" && state.items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {state.items.map((r) => (
            <li key={r.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <span>{r.carrier}</span>
                    <span className="text-sm font-normal text-muted-foreground">
                      {r.statementRef} · {r.periodKey}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-3 gap-x-4 gap-y-1 text-sm">
                    <div className="flex flex-col">
                      <dt className="text-xs text-muted-foreground">
                        {t("finance.reconciliations.field.statementAmount")}
                      </dt>
                      <dd className="tabular-nums">{formatMoney(r.totalStatementMinor, locale)}</dd>
                    </div>
                    <div className="flex flex-col">
                      <dt className="text-xs text-muted-foreground">{t("shipping.field.fee")}</dt>
                      <dd className="tabular-nums">{formatMoney(r.totalFeeMinor, locale)}</dd>
                    </div>
                    <div className="flex flex-col">
                      <dt className="text-xs text-muted-foreground">
                        {t("finance.reconciliations.detail.variance")}
                      </dt>
                      <dd className="tabular-nums">{formatMoney(r.totalVarianceMinor, locale)}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}

      {state.kind === "ready" && state.nextCursor !== null ? (
        <Button variant="outline" onClick={() => void loadMore()} className="self-center">
          {t("finance.loadMore")}
        </Button>
      ) : null}
    </div>
  );
}

function ReconciliationForm({
  onDone,
  onFail,
  onCancel,
}: {
  onDone: (message: string) => void | Promise<void>;
  onFail: () => void;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [carrier, setCarrier] = useState("");
  const [statementRef, setStatementRef] = useState("");
  const [periodKey, setPeriodKey] = useState("");
  const [lines, setLines] = useState<CreateReconciliationLineInput[]>([]);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [statementAmount, setStatementAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const addLine = (): void => {
    const amountMinor = Math.round(Number(statementAmount) * 100);
    if (trackingNumber.trim().length === 0 || !Number.isFinite(amountMinor)) return;
    setLines([
      ...lines,
      { trackingNumber: trackingNumber.trim(), statementAmountMinor: amountMinor },
    ]);
    setTrackingNumber("");
    setStatementAmount("");
  };

  const invalid =
    carrier.trim().length === 0 ||
    statementRef.trim().length === 0 ||
    !/^\d{4}-\d{2}$/.test(periodKey) ||
    lines.length === 0;

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    try {
      await createReconciliation(
        { carrier: carrier.trim(), statementRef: statementRef.trim(), periodKey, lines },
        newIdempotencyKey(),
      );
      await onDone(t("finance.saved"));
    } catch {
      onFail();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field id="recon-carrier" label={t("finance.reconciliations.field.carrier")}>
            <Input
              id="recon-carrier"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              aria-label={t("finance.reconciliations.field.carrier")}
            />
          </Field>
          <Field id="recon-statement-ref" label={t("finance.reconciliations.field.statementRef")}>
            <Input
              id="recon-statement-ref"
              value={statementRef}
              onChange={(e) => setStatementRef(e.target.value)}
              aria-label={t("finance.reconciliations.field.statementRef")}
            />
          </Field>
          <Field id="recon-period" label={t("finance.reconciliations.field.periodKey")}>
            <Input
              id="recon-period"
              placeholder="2026-01"
              value={periodKey}
              onChange={(e) => setPeriodKey(e.target.value)}
              aria-label={t("finance.reconciliations.field.periodKey")}
            />
          </Field>
        </div>

        {lines.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {lines.map((line, idx) => (
              <li key={`${line.trackingNumber}-${idx}`} className="flex justify-between">
                <span>{line.trackingNumber}</span>
                <span className="tabular-nums text-muted-foreground">
                  {(line.statementAmountMinor / 100).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-end gap-2">
          <Field id="recon-tracking" label={t("finance.reconciliations.field.trackingNumber")}>
            <Input
              id="recon-tracking"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              aria-label={t("finance.reconciliations.field.trackingNumber")}
            />
          </Field>
          <Field id="recon-amount" label={t("finance.reconciliations.field.statementAmount")}>
            <Input
              id="recon-amount"
              type="number"
              min={0}
              step="0.01"
              value={statementAmount}
              onChange={(e) => setStatementAmount(e.target.value)}
              aria-label={t("finance.reconciliations.field.statementAmount")}
            />
          </Field>
          <Button size="sm" variant="outline" onClick={addLine}>
            {t("finance.reconciliations.form.addLine")}
          </Button>
        </div>

        <div className="flex gap-2">
          <Button size="sm" disabled={submitting || invalid} onClick={() => void submit()}>
            {t("finance.actions.save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t("finance.actions.cancel")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
