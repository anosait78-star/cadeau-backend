import type { Column } from "@/components/data-grid/types";
import { StatusBadge } from "@/components/status-badge/status-badge";
import type { Translate } from "@/components/i18n/translate-type";
import type { CustomerListItem } from "@/features/customers/customers-api";

const DASH = "—";

function formatMoney(minorUnits: number, locale: string): string {
  return (minorUnits / 100).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso: string | null, locale: string): string {
  return iso === null ? DASH : new Date(iso).toLocaleDateString(locale);
}

/**
 * Customers' `Column<CustomerListItem>[]` defs for the generic DataGrid.
 * Purely presentational glue — create/edit/archive logic lives in
 * customers-page.tsx.
 */
export function buildCustomerColumns({
  t,
  locale,
}: {
  t: Translate;
  locale: string;
}): Column<CustomerListItem>[] {
  return [
    {
      key: "name",
      header: t("customers.field.name"),
      render: (row) => <span className="font-medium">{row.name}</span>,
      clientSortable: true,
      sortAccessor: (row) => row.name,
    },
    {
      key: "phone",
      header: t("customers.field.phone"),
      // Masked on the list by design — the full number needs a detail read.
      render: (row) => <span dir="ltr">{row.phoneMasked}</span>,
    },
    {
      key: "email",
      header: t("customers.field.email"),
      render: (row) => <span>{row.email ?? DASH}</span>,
    },
    {
      key: "orders",
      header: t("customers.kpi.orders"),
      render: (row) => <span>{row.ordersCount}</span>,
      clientSortable: true,
      sortAccessor: (row) => row.ordersCount,
      align: "end",
    },
    {
      key: "spent",
      header: t("customers.kpi.spent"),
      render: (row) => <span dir="ltr">{formatMoney(row.totalSpent, locale)}</span>,
      clientSortable: true,
      sortAccessor: (row) => row.totalSpent,
      align: "end",
    },
    {
      key: "lastOrder",
      header: t("customers.kpi.lastOrder"),
      render: (row) => <span dir="ltr">{formatDate(row.lastOrderAt, locale)}</span>,
    },
    {
      key: "status",
      header: t("customers.status.title"),
      render: (row) => (
        <StatusBadge
          tone={row.active ? "success" : "neutral"}
          label={row.active ? t("customers.status.active") : t("customers.status.inactive")}
        />
      ),
    },
  ];
}
