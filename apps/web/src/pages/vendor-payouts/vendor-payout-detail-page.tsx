import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { FeatureGate } from "@/components/access/feature-gate";
import { PermissionGate } from "@/components/access/permission-gate";
import { PageTitle } from "@/components/layout/page-title";
import { useRegisterMobileRefresh } from "@/components/shell/mobile/mobile-header-context";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useToast } from "@/components/toast/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  useVendorAccount,
  type VendorAccountSource,
} from "@/features/vendor-payouts/use-vendor-account";
import {
  cancelVendorPayout,
  createVendorAdjustment,
  forceConfirmVendorPayout,
  getVendorBalance,
  listVendorLedger,
  listVendorPayouts,
  PAYOUT_METHODS,
  requestVendorPayout,
  type PayoutMethod,
  type VendorBalance,
  type VendorPayout,
} from "@/features/vendor-payouts/vendor-payouts-api";
import {
  BalanceTiles,
  LedgerList,
  PayoutRow,
} from "@/features/vendor-payouts/vendor-payouts-parts";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/format-money";

const MANAGE = "vendor_payouts.manage";

type Dialog =
  | { readonly kind: "none" }
  | { readonly kind: "request" }
  | { readonly kind: "cancel"; readonly payout: VendorPayout }
  | { readonly kind: "force"; readonly payout: VendorPayout }
  | { readonly kind: "adjust" };

/**
 * One vendor's account, company side: balance, statement and payouts, plus the
 * money-moving actions (each behind `vendor_payouts.manage`, re-checked by the
 * API): request a payout of everything owed, cancel a pending one, confirm it
 * on the vendor's behalf with a reason, and post a manual adjustment.
 */
export function VendorPayoutDetailPage(): ReactNode {
  const { t } = useI18n();
  const { warehouseId } = useParams<{ warehouseId: string }>();
  return (
    <FeatureGate
      feature="vendor_payouts"
      fallback={<EmptyState title={t("vendorPayouts.forbidden")} />}
    >
      {warehouseId === undefined ? (
        <EmptyState title={t("vendorPayouts.detail.notFound")} />
      ) : (
        <VendorPayoutDetail warehouseId={warehouseId} />
      )}
    </FeatureGate>
  );
}

function VendorPayoutDetail({ warehouseId }: { warehouseId: string }): ReactNode {
  const { t } = useI18n();
  const toast = useToast();
  const source = useMemo<VendorAccountSource>(
    () => ({
      balance: () => getVendorBalance(warehouseId),
      ledger: (cursor) => listVendorLedger(warehouseId, cursor),
      payouts: () => listVendorPayouts(warehouseId),
    }),
    [warehouseId],
  );
  const { state, reload, loadMore, loadingMore } = useVendorAccount(source);
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });

  useRegisterMobileRefresh(() => reload());

  const close = (): void => setDialog({ kind: "none" });
  const done = async (message: TranslationKey): Promise<void> => {
    toast.show(t(message));
    close();
    await reload();
  };
  const failed = (error: unknown): void => {
    // The API's own sentence when it explains a business refusal (nothing owed,
    // a payout already pending, a closed period); a generic one otherwise.
    toast.show(
      error instanceof ApiError && error.statusCode < 500
        ? error.message
        : t("vendorPayouts.actionFailed"),
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 lg:p-6">
      <Link to="/vendor-payouts" className="text-sm text-primary hover:underline">
        {t("vendorPayouts.detail.back")}
      </Link>

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={() => void reload()} /> : null}

      {state.kind === "ready" ? (
        <>
          <PageTitle
            title={state.balance.warehouseName}
            description={state.balance.vendorName ?? t("vendorPayouts.detail.noAccount")}
          />
          <BalanceTiles balance={state.balance} />

          <PermissionGate permission={MANAGE}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                disabled={state.balance.owedMinor <= 0 || state.balance.pendingPayoutId !== null}
                onClick={() => setDialog({ kind: "request" })}
              >
                {t("vendorPayouts.detail.requestPayout")}
              </Button>
              <Button variant="outline" onClick={() => setDialog({ kind: "adjust" })}>
                {t("vendorPayouts.detail.addAdjustment")}
              </Button>
            </div>
            {state.balance.needsPricingCount > 0 ? (
              <p className="text-sm text-destructive">
                {t("vendorPayouts.detail.needsPricingHint", {
                  count: state.balance.needsPricingCount,
                })}
              </p>
            ) : null}
          </PermissionGate>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("vendorPayouts.payouts.title")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {state.payouts.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("vendorPayouts.payouts.empty")}</p>
              ) : (
                state.payouts.map((payout) => (
                  <PayoutRow
                    key={payout.id}
                    payout={payout}
                    actions={
                      payout.status === "pending" ? (
                        <PermissionGate permission={MANAGE}>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDialog({ kind: "force", payout })}
                          >
                            {t("vendorPayouts.detail.forceConfirm")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDialog({ kind: "cancel", payout })}
                          >
                            {t("vendorPayouts.detail.cancelPayout")}
                          </Button>
                        </PermissionGate>
                      ) : undefined
                    }
                  />
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("vendorPayouts.ledger.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <LedgerList
                entries={state.entries}
                hasMore={state.nextCursor !== null}
                loadingMore={loadingMore}
                onLoadMore={() => void loadMore()}
              />
            </CardContent>
          </Card>

          {dialog.kind === "request" ? (
            <RequestPayoutDialog
              balance={state.balance}
              onClose={close}
              onSubmit={async (body, key) => {
                try {
                  await requestVendorPayout(warehouseId, body, key);
                  await done("vendorPayouts.detail.requested");
                } catch (error) {
                  failed(error);
                }
              }}
            />
          ) : null}
          {dialog.kind === "adjust" ? (
            <AdjustmentDialog
              onClose={close}
              onSubmit={async (body) => {
                try {
                  await createVendorAdjustment(warehouseId, body);
                  await done("vendorPayouts.detail.adjusted");
                } catch (error) {
                  failed(error);
                }
              }}
            />
          ) : null}
          {dialog.kind === "cancel" ? (
            <ConfirmDialog
              title={t("vendorPayouts.detail.cancelTitle")}
              body={t("vendorPayouts.detail.cancelBody")}
              confirmLabel={t("vendorPayouts.detail.cancelPayout")}
              onClose={close}
              onConfirm={async () => {
                try {
                  await cancelVendorPayout(dialog.payout.id);
                  await done("vendorPayouts.detail.cancelled");
                } catch (error) {
                  failed(error);
                }
              }}
            />
          ) : null}
          {dialog.kind === "force" ? (
            <ForceConfirmDialog
              payout={dialog.payout}
              onClose={close}
              onSubmit={async (reason) => {
                try {
                  await forceConfirmVendorPayout(dialog.payout.id, reason);
                  await done("vendorPayouts.detail.forceConfirmed");
                } catch (error) {
                  failed(error);
                }
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Shared submit-in-flight handling for the dialogs below. */
function useBusy(): [boolean, (action: () => Promise<void>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };
  return [busy, run];
}

function DialogActions({
  busy,
  disabled = false,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  disabled?: boolean;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactNode {
  const { t } = useI18n();
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button variant="ghost" disabled={busy} onClick={onCancel}>
        {t("vendorPayouts.cancel")}
      </Button>
      <Button disabled={busy || disabled} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </div>
  );
}

function RequestPayoutDialog({
  balance,
  onClose,
  onSubmit,
}: {
  balance: VendorBalance;
  onClose: () => void;
  onSubmit: (
    body: { method: PayoutMethod; reference?: string; notes?: string },
    idempotencyKey: string,
  ) => Promise<void>;
}): ReactNode {
  const { t, locale } = useI18n();
  const [busy, run] = useBusy();
  const [method, setMethod] = useState<PayoutMethod>("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  // One key for the life of this dialog: a double click or a retry replays the
  // same payout rather than creating a second one.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  return (
    <Modal
      open
      onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}
      title={t("vendorPayouts.detail.requestPayout")}
      size="md"
    >
      <div className="flex flex-col gap-4 overflow-y-auto p-6">
        <p className="text-sm">
          {t("vendorPayouts.detail.requestBody", {
            amount: formatMoney(balance.owedMinor, locale),
          })}
        </p>
        <FormField label={t("vendorPayouts.detail.method")} htmlFor="payout-method" required>
          <select
            id="payout-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as PayoutMethod)}
            className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            {PAYOUT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`vendorPayouts.method.${m}` as TranslationKey)}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label={t("vendorPayouts.detail.reference")} htmlFor="payout-reference" optional>
          <Input
            id="payout-reference"
            value={reference}
            maxLength={200}
            onChange={(e) => setReference(e.target.value)}
          />
        </FormField>
        <FormField label={t("vendorPayouts.detail.notes")} htmlFor="payout-notes" optional>
          <Input
            id="payout-notes"
            value={notes}
            maxLength={1000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </FormField>
        <DialogActions
          busy={busy}
          confirmLabel={t("vendorPayouts.detail.requestConfirm")}
          onCancel={onClose}
          onConfirm={() =>
            void run(() =>
              onSubmit(
                {
                  method,
                  ...(reference.trim().length > 0 ? { reference: reference.trim() } : {}),
                  ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
                },
                idempotencyKey,
              ),
            )
          }
        />
      </div>
    </Modal>
  );
}

function AdjustmentDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (body: { amountMinor: number; note: string }) => Promise<void>;
}): ReactNode {
  const { t } = useI18n();
  const [busy, run] = useBusy();
  const [direction, setDirection] = useState<"add" | "deduct">("add");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const minor = Math.round(Number(amount.trim()) * 100);
  const valid =
    amount.trim().length > 0 && Number.isFinite(minor) && minor > 0 && note.trim().length >= 3;

  return (
    <Modal
      open
      onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}
      title={t("vendorPayouts.detail.addAdjustment")}
      size="md"
    >
      <div className="flex flex-col gap-4 overflow-y-auto p-6">
        <p className="text-sm text-muted-foreground">{t("vendorPayouts.detail.adjustHint")}</p>
        <FormField label={t("vendorPayouts.detail.direction")} htmlFor="adjust-direction" required>
          <select
            id="adjust-direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value as "add" | "deduct")}
            className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="add">{t("vendorPayouts.detail.directionAdd")}</option>
            <option value="deduct">{t("vendorPayouts.detail.directionDeduct")}</option>
          </select>
        </FormField>
        <FormField label={t("vendorPayouts.detail.amount")} htmlFor="adjust-amount" required>
          <Input
            id="adjust-amount"
            inputMode="decimal"
            dir="ltr"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </FormField>
        <FormField label={t("vendorPayouts.detail.note")} htmlFor="adjust-note" required>
          <Input
            id="adjust-note"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>
        <DialogActions
          busy={busy}
          disabled={!valid}
          confirmLabel={t("vendorPayouts.detail.adjustConfirm")}
          onCancel={onClose}
          onConfirm={() =>
            void run(() =>
              onSubmit({
                amountMinor: direction === "add" ? minor : -minor,
                note: note.trim(),
              }),
            )
          }
        />
      </div>
    </Modal>
  );
}

function ForceConfirmDialog({
  payout,
  onClose,
  onSubmit,
}: {
  payout: VendorPayout;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}): ReactNode {
  const { t, locale } = useI18n();
  const [busy, run] = useBusy();
  const [reason, setReason] = useState("");

  return (
    <Modal
      open
      onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}
      title={t("vendorPayouts.detail.forceConfirm")}
      size="md"
    >
      <div className="flex flex-col gap-4 overflow-y-auto p-6">
        <p className="text-sm">
          {t("vendorPayouts.detail.forceBody", { amount: formatMoney(payout.amountMinor, locale) })}
        </p>
        <FormField label={t("vendorPayouts.detail.reason")} htmlFor="force-reason" required>
          <Input
            id="force-reason"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
        </FormField>
        <DialogActions
          busy={busy}
          disabled={reason.trim().length < 3}
          confirmLabel={t("vendorPayouts.detail.forceConfirm")}
          onCancel={onClose}
          onConfirm={() => void run(() => onSubmit(reason.trim()))}
        />
      </div>
    </Modal>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}): ReactNode {
  const [busy, run] = useBusy();
  return (
    <Modal
      open
      onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}
      title={title}
      size="sm"
    >
      <div className="flex flex-col gap-4 p-6">
        <p className="text-sm">{body}</p>
        <DialogActions
          busy={busy}
          confirmLabel={confirmLabel}
          onCancel={onClose}
          onConfirm={() => void run(onConfirm)}
        />
      </div>
    </Modal>
  );
}
