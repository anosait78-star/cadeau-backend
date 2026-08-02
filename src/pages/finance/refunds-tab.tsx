import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { PermissionGate } from "@/components/access/permission-gate";
import { DataGrid } from "@/components/data-grid/data-grid";
import { MobileCardList } from "@/components/data-grid/mobile-card-list";
import { DetailPanel } from "@/components/detail-panel/detail-panel";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { TableToolbar } from "@/components/table-toolbar/table-toolbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createRefund,
  listRefunds,
  newIdempotencyKey,
  type Refund,
} from "@/features/finance/finance-api";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useI18n } from "@/i18n/i18n-provider";
import { buildRefundColumns } from "./refunds-columns";
import { DASH, Field, formatDate, formatMoney } from "./finance-shared";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly items: Refund[]; readonly nextCursor: string | null };

/** Refunds — money out against a prior invoice/order. Idempotency-Key is mandatory (D2). */
export function RefundsTab({ onNotify }: { onNotify: (text: string) => void }): ReactNode {
  const { t, locale } = useI18n();
  const isDesktop = useIsDesktop();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Refund | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const page = await listRefunds();
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
    const page = await listRefunds({ cursor: state.nextCursor });
    setState({
      kind: "ready",
      items: [...state.items, ...page.data],
      nextCursor: page.page.nextCursor,
    });
  };

  const columns = useMemo(() => buildRefundColumns({ t, locale }), [t, locale]);

  const renderRefundCard = (refund: Refund): ReactNode => <RefundCard refund={refund} />;

  return (
    <div className="flex flex-col gap-4">
      <TableToolbar
        primaryActions={
          <PermissionGate permission="finance.manage">
            {creating ? null : (
              <Button onClick={() => setCreating(true)}>{t("finance.actions.create")}</Button>
            )}
          </PermissionGate>
        }
      />

      {creating ? (
        <PermissionGate permission="finance.manage">
          <RefundForm
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

      {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}

      {state.kind !== "error" ? (
        isDesktop ? (
          <DataGrid<Refund>
            columns={columns}
            rows={state.kind === "ready" ? state.items : []}
            getRowId={(row) => row.id}
            loading={state.kind === "loading"}
            hasMore={state.kind === "ready" && state.nextCursor !== null}
            onLoadMore={loadMore}
            onRowClick={setSelected}
            emptyState={<EmptyState title={t("finance.refunds.empty")} />}
          />
        ) : (
          <MobileCardList<Refund>
            items={state.kind === "ready" ? state.items : []}
            loading={state.kind === "loading"}
            getRowId={(row) => row.id}
            renderCard={renderRefundCard}
            emptyTitle={t("finance.refunds.empty")}
            hasMore={state.kind === "ready" && state.nextCursor !== null}
            onLoadMore={loadMore}
            loadMoreLabel={t("finance.loadMore")}
          />
        )
      ) : null}

      <DetailPanel
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={selected !== null ? formatMoney(selected.amountMinor, locale) : ""}
        sections={
          selected === null
            ? []
            : [
                {
                  key: "details",
                  label: t("finance.refunds.field.reason"),
                  content: renderRefundCard(selected),
                },
              ]
        }
      />
    </div>
  );
}

function RefundCard({ refund }: { refund: Refund }): ReactNode {
  const { t, locale } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span className="tabular-nums">{formatMoney(refund.amountMinor, locale)}</span>
          <span className="text-sm font-normal text-muted-foreground">
            {formatDate(refund.createdAt, locale)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        <p>{refund.reason}</p>
        <p className="text-xs text-muted-foreground">
          {t("finance.refunds.field.invoice")}: {refund.invoiceId ?? DASH} ·{" "}
          {t("finance.refunds.field.order")}: {refund.orderId ?? DASH}
        </p>
      </CardContent>
    </Card>
  );
}

function RefundForm({
  onDone,
  onFail,
  onCancel,
}: {
  onDone: (message: string) => void | Promise<void>;
  onFail: () => void;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [invoiceId, setInvoiceId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const amountMinor = Math.round(Number(amount) * 100);
  const invalid =
    (invoiceId.trim().length === 0 && orderId.trim().length === 0) ||
    !Number.isFinite(amountMinor) ||
    amountMinor < 1 ||
    reason.trim().length === 0;

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    try {
      await createRefund(
        {
          ...(invoiceId.trim().length > 0 ? { invoiceId: invoiceId.trim() } : {}),
          ...(orderId.trim().length > 0 ? { orderId: orderId.trim() } : {}),
          amountMinor,
          reason: reason.trim(),
        },
        // Idempotency-Key is mandatory for refunds (D2) — a fresh key per submit.
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="refund-invoice" label={t("finance.refunds.field.invoice")}>
            <Input
              id="refund-invoice"
              value={invoiceId}
              onChange={(e) => setInvoiceId(e.target.value)}
              aria-label={t("finance.refunds.field.invoice")}
            />
          </Field>
          <Field id="refund-order" label={t("finance.refunds.field.order")}>
            <Input
              id="refund-order"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              aria-label={t("finance.refunds.field.order")}
            />
          </Field>
          <Field id="refund-amount" label={t("finance.refunds.field.amount")}>
            <Input
              id="refund-amount"
              type="number"
              min={0.01}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label={t("finance.refunds.field.amount")}
            />
          </Field>
          <Field id="refund-reason" label={t("finance.refunds.field.reason")} wide>
            <Input
              id="refund-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label={t("finance.refunds.field.reason")}
            />
          </Field>
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
