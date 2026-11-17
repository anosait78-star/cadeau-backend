import { useState } from "react";
import type { ReactNode } from "react";
import { FeatureGate } from "@/components/access/feature-gate";
import { PageTitle } from "@/components/layout/page-title";
import { useRegisterMobileRefresh } from "@/components/shell/mobile/mobile-header-context";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useToast } from "@/components/toast/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import {
  useVendorAccount,
  type VendorAccountSource,
} from "@/features/vendor-payouts/use-vendor-account";
import {
  confirmMyVendorPayout,
  getMyVendorAccount,
  listMyVendorLedger,
  listMyVendorPayouts,
  type VendorPayout,
} from "@/features/vendor-payouts/vendor-payouts-api";
import {
  BalanceTiles,
  LedgerList,
  PayoutRow,
} from "@/features/vendor-payouts/vendor-payouts-parts";
import { useI18n } from "@/i18n/i18n-provider";
import { formatMoney } from "@/lib/format-money";

/** Module-level so the hook's loaders keep a stable identity across renders. */
const MY_ACCOUNT: VendorAccountSource = {
  balance: getMyVendorAccount,
  ledger: listMyVendorLedger,
  payouts: () => listMyVendorPayouts(),
};

/**
 * "حسابي" — the vendor's own account with the company (vendor payouts): what
 * they are owed, the payout waiting for them, their statement and their payout
 * history. Every figure comes from `/v1/vendor/account`, scoped server-side to
 * the vendor's own warehouse (and by RLS), so there is nothing here to hide.
 *
 * "استلمت المبلغ" settles money, so it is a deliberate two-step action: the
 * prominent button opens a confirmation that repeats the amount, and only that
 * confirmation calls the API.
 */
export function VendorAccountPage(): ReactNode {
  const { t } = useI18n();
  return (
    <FeatureGate
      feature="vendor_payouts"
      fallback={<EmptyState title={t("vendorPayouts.forbidden")} />}
    >
      <VendorAccountScreen />
    </FeatureGate>
  );
}

function VendorAccountScreen(): ReactNode {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { state, reload, loadMore, loadingMore } = useVendorAccount(MY_ACCOUNT);
  const [confirming, setConfirming] = useState<VendorPayout | null>(null);
  const [busy, setBusy] = useState(false);

  useRegisterMobileRefresh(() => reload());

  const confirm = async (payout: VendorPayout): Promise<void> => {
    setBusy(true);
    try {
      await confirmMyVendorPayout(payout.id);
      toast.show(t("vendorPayouts.account.confirmed"));
      setConfirming(null);
      await reload();
    } catch {
      toast.show(t("vendorPayouts.actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const pending =
    state.kind === "ready" ? state.payouts.find((p) => p.status === "pending") : undefined;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title={t("vendorPayouts.account.title")}
        description={t("vendorPayouts.account.subtitle")}
      />

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={() => void reload()} /> : null}

      {state.kind === "ready" ? (
        <>
          <BalanceTiles balance={state.balance} />

          {pending !== undefined ? (
            <Card className="border-primary/40">
              <CardHeader>
                <CardTitle className="text-base">
                  {t("vendorPayouts.account.pendingTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  {t("vendorPayouts.account.pendingBody")}
                </p>
                <PayoutRow payout={pending} />
                <Button
                  className="h-12 w-full text-base sm:w-auto"
                  onClick={() => setConfirming(pending)}
                >
                  {t("vendorPayouts.account.confirmButton")}
                </Button>
              </CardContent>
            </Card>
          ) : null}

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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("vendorPayouts.payouts.title")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {state.payouts.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("vendorPayouts.payouts.empty")}</p>
              ) : (
                state.payouts.map((payout) => <PayoutRow key={payout.id} payout={payout} />)
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      <Modal
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirming(null);
        }}
        title={t("vendorPayouts.account.confirmTitle")}
        size="sm"
      >
        {confirming !== null ? (
          <div className="flex flex-col gap-4 p-6">
            <p className="text-sm">
              {t("vendorPayouts.account.confirmBody", {
                amount: formatMoney(confirming.amountMinor, locale),
              })}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
                {t("vendorPayouts.cancel")}
              </Button>
              <Button disabled={busy} onClick={() => void confirm(confirming)}>
                {t("vendorPayouts.account.confirmYes")}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
