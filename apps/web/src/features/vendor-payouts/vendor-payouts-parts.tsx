import type { ReactNode } from "react";
import { StatusBadge, type BadgeTone } from "@/components/status-badge/status-badge";
import { Button } from "@/components/ui/button";
import { useIsDesktop } from "@/hooks/use-media-query";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { formatMoney } from "@/lib/format-money";
import type {
  LedgerEntry,
  LedgerEntryState,
  PayoutStatus,
  VendorBalance,
  VendorPayout,
} from "./vendor-payouts-api";

const STATE_TONE: Readonly<Record<LedgerEntryState, BadgeTone>> = {
  open: "warning",
  pending: "info",
  settled: "success",
};

const PAYOUT_TONE: Readonly<Record<PayoutStatus, BadgeTone>> = {
  pending: "warning",
  confirmed: "success",
  cancelled: "neutral",
};

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** What one ledger row is, in words: the product line, or the adjustment's note. */
function entryDescription(entry: LedgerEntry, t: (key: TranslationKey) => string): string {
  if (entry.kind === "adjustment") return entry.note ?? t("vendorPayouts.kind.adjustment");
  return entry.nameSnapshot ?? "—";
}

/** One balance figure (owed / pending / paid / unpriced). */
function Tile({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: ReactNode;
  emphasis?: boolean;
}): ReactNode {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          emphasis
            ? "text-xl font-semibold tabular-nums text-primary"
            : "text-lg font-semibold tabular-nums"
        }
        dir="ltr"
      >
        {value}
      </p>
    </div>
  );
}

/** The four headline figures of a vendor's account; two per row on a phone. */
export function BalanceTiles({ balance }: { balance: VendorBalance }): ReactNode {
  const { t, locale } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile
        label={t("vendorPayouts.balance.owed")}
        value={formatMoney(balance.owedMinor, locale)}
        emphasis
      />
      <Tile
        label={t("vendorPayouts.balance.pending")}
        value={formatMoney(balance.pendingMinor, locale)}
      />
      <Tile
        label={t("vendorPayouts.balance.paid")}
        value={formatMoney(balance.paidMinor, locale)}
      />
      <Tile label={t("vendorPayouts.balance.needsPricing")} value={balance.needsPricingCount} />
    </div>
  );
}

/**
 * A vendor's statement. A table on desktop; on a phone each row becomes a card
 * (ADR-002: no table squeezed onto a small screen). The amount carries its own
 * sign, so a reversal or a deduction reads as negative without a legend.
 */
export function LedgerList({
  entries,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  entries: readonly LedgerEntry[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}): ReactNode {
  const { t, locale } = useI18n();
  const isDesktop = useIsDesktop();

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("vendorPayouts.ledger.empty")}</p>;
  }

  const kindLabel = (entry: LedgerEntry): string =>
    t(`vendorPayouts.kind.${entry.kind}` as TranslationKey);
  const amount = (entry: LedgerEntry): ReactNode => (
    <span
      dir="ltr"
      className={
        entry.amountMinor < 0 ? "tabular-nums text-destructive" : "tabular-nums text-foreground"
      }
    >
      {formatMoney(entry.amountMinor, locale)}
    </span>
  );
  const badge = (entry: LedgerEntry): ReactNode =>
    entry.needsPricing ? (
      <StatusBadge tone="destructive" label={t("vendorPayouts.state.needsPricing")} />
    ) : (
      <StatusBadge
        tone={STATE_TONE[entry.state]}
        label={t(`vendorPayouts.state.${entry.state}` as TranslationKey)}
      />
    );

  return (
    <div className="flex flex-col gap-3">
      {isDesktop ? (
        <table className="w-full text-sm">
          <thead className="text-start text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-2 text-start font-medium">{t("vendorPayouts.ledger.date")}</th>
              <th className="py-2 text-start font-medium">{t("vendorPayouts.ledger.kind")}</th>
              <th className="py-2 text-start font-medium">{t("vendorPayouts.ledger.order")}</th>
              <th className="py-2 text-start font-medium">{t("vendorPayouts.ledger.item")}</th>
              <th className="py-2 text-end font-medium">{t("vendorPayouts.ledger.quantity")}</th>
              <th className="py-2 text-end font-medium">{t("vendorPayouts.ledger.amount")}</th>
              <th className="py-2 text-end font-medium">{t("vendorPayouts.ledger.state")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-border/60">
                <td className="py-2">{formatDate(entry.createdAt, locale)}</td>
                <td className="py-2">{kindLabel(entry)}</td>
                <td className="py-2 tabular-nums">
                  {entry.orderNumber === null ? "—" : `#${entry.orderNumber}`}
                </td>
                <td className="max-w-[260px] truncate py-2">{entryDescription(entry, t)}</td>
                <td className="py-2 text-end tabular-nums">{entry.quantity ?? "—"}</td>
                <td className="py-2 text-end">{amount(entry)}</td>
                <td className="py-2 text-end">{badge(entry)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{entryDescription(entry, t)}</p>
                  <p className="text-caption text-muted-foreground">
                    {kindLabel(entry)}
                    {entry.orderNumber === null ? "" : ` · #${entry.orderNumber}`}
                    {entry.quantity === null ? "" : ` · ×${entry.quantity}`}
                  </p>
                </div>
                <div className="shrink-0 text-end text-sm font-semibold">{amount(entry)}</div>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-caption text-muted-foreground">
                  {formatDate(entry.createdAt, locale)}
                </span>
                {badge(entry)}
              </div>
            </li>
          ))}
        </ul>
      )}
      {hasMore ? (
        <Button variant="outline" size="sm" disabled={loadingMore} onClick={onLoadMore}>
          {t("vendorPayouts.loadMore")}
        </Button>
      ) : null}
    </div>
  );
}

/** A payout's one-line summary, shared by both sides' history lists. */
export function PayoutRow({
  payout,
  actions,
}: {
  payout: VendorPayout;
  actions?: ReactNode;
}): ReactNode {
  const { t, locale } = useI18n();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold tabular-nums" dir="ltr">
          {formatMoney(payout.amountMinor, locale)}
        </p>
        <p className="text-caption text-muted-foreground">
          {t(`vendorPayouts.method.${payout.method}` as TranslationKey)} ·{" "}
          {formatDate(payout.createdAt, locale)}
          {payout.reference === null ? "" : ` · ${payout.reference}`}
        </p>
        {payout.confirmationKind === "forced" ? (
          <p className="text-caption text-warning">
            {t("vendorPayouts.payout.forcedBy")}
            {payout.forceReason === null ? "" : `: ${payout.forceReason}`}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          tone={PAYOUT_TONE[payout.status]}
          label={t(`vendorPayouts.payout.status.${payout.status}` as TranslationKey)}
        />
        {actions}
      </div>
    </div>
  );
}
