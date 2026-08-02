import type { ReactNode } from "react";
import type { Column } from "@/components/data-grid/types";
import type { BadgeTone } from "@/components/status-badge/status-badge";
import { StatusBadge as Badge } from "@/components/status-badge/status-badge";
import type { OrderListItem } from "@/features/orders/orders-api";
import type { TranslationKey } from "@/i18n/dictionaries";

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

export function StatusBadge({ label }: { label: string }): ReactNode {
  return <Badge tone="neutral" label={label} testId="status" />;
}

export interface OrderLabel {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
}

function formatMoney(minorUnits: number, locale: string): string {
  return (minorUnits / 100).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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
      render: (row) => <span className="font-medium">#{row.orderNumber}</span>,
      sortable: false,
      width: "6rem",
    },
    {
      key: "customer",
      header: t("orders.form.customer"),
      render: (row) => <span>{row.customerName}</span>,
      clientSortable: true,
      sortAccessor: (row) => row.customerName,
    },
    {
      key: "products",
      header: t("orders.field.items"),
      render: (row) => <span className="text-muted-foreground">{row.itemCount}</span>,
    },
    {
      key: "amount",
      header: t("orders.field.total"),
      render: (row) => <span dir="ltr">{formatMoney(row.total, locale)}</span>,
      clientSortable: true,
      sortAccessor: (row) => row.total,
      align: "end",
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
      key: "status",
      header: t("orders.status.title"),
      render: (row) => <StatusBadge label={t(`orders.status.${row.status}` as TranslationKey)} />,
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
    },
    {
      key: "assigned",
      header: t("orders.field.assigned"),
      render: (row) =>
        row.assigneeId === null ? (
          <span className="text-muted-foreground">{DASH}</span>
        ) : (
          <span className="text-xs">{row.assigneeId}</span>
        ),
    },
    {
      key: "createdAt",
      header: t("orders.field.createdAt"),
      render: (row) => <span dir="ltr">{formatDate(row.createdAt, locale)}</span>,
      sortable: true,
    },
  ];
}
