import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import type { Column } from "@/components/data-grid/types";
import type { BadgeTone } from "@/components/status-badge/status-badge";
import { StatusBadge as Badge } from "@/components/status-badge/status-badge";
import type { OrderListItem } from "@/features/orders/orders-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format-money";
import { ORDER_STATUS_TONE } from "./orders-status-tones";

const PAYMENT_TONE: Readonly<Record<OrderListItem["paymentStatus"], BadgeTone>> = {
  paid: "success",
  partial: "warning",
  unpaid: "destructive",
};

export function PaymentBadge({
  status,
  label,
}: {
  status: OrderListItem["paymentStatus"];
  label: string;
}): ReactNode {
  return <Badge tone={PAYMENT_TONE[status]} label={label} testId="payment-status" />;
}

export function StatusBadge({
  label,
  status,
}: {
  label: string;
  status: OrderListItem["status"];
}): ReactNode {
  return <Badge tone={ORDER_STATUS_TONE[status]} label={label} testId="status" />;
}

export interface OrderLabel {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
}

function formatDateTime(iso: string, locale: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(locale, { year: "numeric", month: "2-digit", day: "2-digit" });
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
}

/** Deterministic avatar tint from the customer name, cycling through existing status tones only (no new brand colors). */
const AVATAR_TONES = [
  "bg-primary/10 text-primary",
  "bg-info/10 text-info",
  "bg-success/10 text-success",
  "bg-warning/10 text-warning",
] as const;

function avatarTone(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash + name.charCodeAt(i)) % AVATAR_TONES.length;
  return AVATAR_TONES[hash]!;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase();
}

function CustomerCell({ name, itemsLabel }: { name: string; itemsLabel: string }): ReactNode {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          avatarTone(name),
        )}
        aria-hidden="true"
      >
        {initials(name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-semibold text-foreground">{name}</span>
        <span className="block truncate text-caption text-muted-foreground">{itemsLabel}</span>
      </span>
    </div>
  );
}

function OrderNumberCell({
  orderNumber,
  copyLabel,
  copiedLabel,
}: {
  orderNumber: number;
  copyLabel: string;
  copiedLabel: string;
}): ReactNode {
  const [copied, setCopied] = useState(false);

  const onCopy = (): void => {
    void navigator.clipboard.writeText(String(orderNumber)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className="font-semibold text-foreground" dir="ltr">
        #{orderNumber}
      </span>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? copiedLabel : copyLabel}
        title={copied ? copiedLabel : copyLabel}
        data-stop-row-click
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

const DASH = "—";

/**
 * Orders' Column<OrderListItem>[] defs for the generic DataGrid. Purely
 * presentational glue - no fetching, no mutation logic (that lives in
 * orders-row-actions.tsx / orders-page.tsx).
 */
export function buildOrderColumns({
  t,
  locale,
  labelsById,
}: {
  t: (key: TranslationKey) => string;
  locale: string;
  labelsById: Map<string, OrderLabel>;
}): Column<OrderListItem>[] {
  return [
    {
      key: "orderNumber",
      header: t("orders.field.orderNumber"),
      render: (row) => (
        <OrderNumberCell
          orderNumber={row.orderNumber}
          copyLabel={t("orders.actions.copyOrderNumber")}
          copiedLabel={t("orders.actions.copied")}
        />
      ),
      sortable: false,
      width: "8rem",
    },
    {
      key: "customer",
      header: t("orders.form.customer"),
      render: (row) => (
        <CustomerCell
          name={row.customerName}
          itemsLabel={`${row.itemCount} ${t("orders.field.items")}`}
        />
      ),
      clientSortable: true,
      sortAccessor: (row) => row.customerName,
    },
    {
      key: "status",
      header: t("orders.status.title"),
      render: (row) => (
        <StatusBadge
          status={row.status}
          label={t(`orders.status.${row.status}` as TranslationKey)}
        />
      ),
    },
    {
      key: "payment",
      header: t("orders.field.payment"),
      render: (row) => (
        <PaymentBadge
          status={row.paymentStatus}
          label={t(`orders.payment.${row.paymentStatus}` as TranslationKey)}
        />
      ),
    },
    {
      key: "amount",
      header: t("orders.field.total"),
      render: (row) => (
        <span className="font-semibold text-foreground tabular-nums" dir="ltr">
          {formatMoney(row.total, locale)}
        </span>
      ),
      clientSortable: true,
      sortAccessor: (row) => row.total,
      align: "end",
    },
    {
      key: "tags",
      header: t("orders.field.tags"),
      render: (row) => {
        if (row.labelId === null) return <span className="text-muted-foreground">{DASH}</span>;
        const label = labelsById.get(row.labelId);
        if (label === undefined) return <span className="text-muted-foreground">{DASH}</span>;
        return (
          <span
            className="rounded px-1.5 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: `${label.color ?? "#6b7280"}22`,
              color: label.color ?? "#6b7280",
            }}
          >
            {label.name}
          </span>
        );
      },
      hideableAtNarrow: true,
      defaultVisible: false,
    },
    {
      key: "createdAt",
      header: t("orders.field.createdAt"),
      render: (row) => (
        <span className="text-muted-foreground" dir="ltr">
          {formatDateTime(row.createdAt, locale)}
        </span>
      ),
      sortable: true,
    },
  ];
}
