import type { ReactNode } from "react";
import type { Column } from "@/components/data-grid/types";
import type { Translate } from "@/components/i18n/translate-type";
import { StatusBadge } from "@/components/status-badge/status-badge";
import type { StorefrontConnection } from "@/features/integrations/storefront-api";

/** Placeholder for a missing optional value. */
export const DASH = "—";

/** `status → tone` for the connection lifecycle badge. */
export function connectionStatusTone(status: string): "success" | "warning" | "destructive" {
  if (status === "active") return "success";
  if (status === "paused") return "warning";
  return "destructive";
}

/** `status → label key` for the connection lifecycle badge. */
export function connectionStatusLabel(status: string, t: Translate): string {
  if (status === "active") return t("storefront.status.active");
  if (status === "paused") return t("storefront.status.paused");
  return t("storefront.status.revoked");
}

/** Format an ISO date-time for display, or a dash when absent. */
export function formatDateTime(iso: string | null, locale: string): string {
  return iso === null ? DASH : new Date(iso).toLocaleString(locale);
}

/**
 * `Column<StorefrontConnection>[]` defs for the connections DataGrid. Purely
 * presentational — create/edit/rotate/revoke logic lives in storefront-panel.tsx.
 */
export function buildStorefrontColumns({
  t,
  locale,
  warehouseName,
}: {
  t: Translate;
  locale: string;
  warehouseName: (warehouseId: string | null) => string;
}): Column<StorefrontConnection>[] {
  return [
    {
      key: "label",
      header: t("storefront.field.label"),
      render: (row): ReactNode => <span className="font-medium">{row.label}</span>,
      clientSortable: true,
      sortAccessor: (row) => row.label,
    },
    {
      key: "platform",
      header: t("storefront.field.platform"),
      render: (row): ReactNode => <span>{t(`storefront.platform.${row.platform}` as never)}</span>,
    },
    {
      key: "apiKeyPrefix",
      header: t("storefront.field.apiKeyPrefix"),
      render: (row): ReactNode => (
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{row.apiKeyPrefix}••••</code>
      ),
    },
    {
      key: "defaultWarehouseId",
      header: t("storefront.field.defaultWarehouse"),
      render: (row): ReactNode => <span>{warehouseName(row.defaultWarehouseId)}</span>,
    },
    {
      key: "status",
      header: t("storefront.field.status"),
      render: (row): ReactNode => (
        <StatusBadge
          tone={connectionStatusTone(row.status)}
          label={connectionStatusLabel(row.status, t)}
        />
      ),
    },
    {
      key: "lastEventAt",
      header: t("storefront.field.lastEventAt"),
      render: (row): ReactNode => <span>{formatDateTime(row.lastEventAt, locale)}</span>,
    },
  ];
}
