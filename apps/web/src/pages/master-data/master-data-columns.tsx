import type { Column } from "@/components/data-grid/types";
import { StatusBadge } from "@/components/status-badge/status-badge";
import type { Translate } from "@/components/i18n/translate-type";
import type { MasterDataItem } from "@/features/master-data/master-data-api";
import type { MdField, MdResource } from "@/features/master-data/resources";

const DASH = "—";

/** The raw string value of an attribute on a row. */
function fieldText(item: MasterDataItem, name: string): string {
  const value = item[name];
  return value === null || value === undefined ? "" : String(value);
}

/** Localize an order-reason kind; other option sets show the raw value. */
function optionLabel(field: MdField, value: string, t: Translate): string {
  if (field.name === "kind") {
    if (value === "cancellation") return t("md.kind.cancellation");
    if (value === "return") return t("md.kind.return");
    if (value === "general") return t("md.kind.general");
  }
  return value;
}

/** The display value of a field, localizing enum options where relevant. */
function displayValue(item: MasterDataItem, field: MdField, t: Translate): string {
  const raw = fieldText(item, field.name);
  if (raw.length === 0) return "";
  if (field.type === "select") return optionLabel(field, raw, t);
  return raw;
}

/**
 * Master Data's `Column<MasterDataItem>[]` defs for the generic DataGrid,
 * driven by the selected resource's field list — every resource gets a
 * different set of columns without a resource-specific columns file.
 */
export function buildMdColumns({
  t,
  resource,
}: {
  t: Translate;
  resource: MdResource;
}): Column<MasterDataItem>[] {
  const fieldColumns: Column<MasterDataItem>[] = resource.fields.map((field) => ({
    key: field.name,
    header: t(field.labelKey),
    render: (row) => <span>{displayValue(row, field, t) || DASH}</span>,
    ...(field.name === "name"
      ? { clientSortable: true, sortAccessor: (row: MasterDataItem) => fieldText(row, "name") }
      : {}),
  }));
  return [
    ...fieldColumns,
    {
      key: "status",
      header: t("md.status.title"),
      render: (row) => (
        <StatusBadge
          tone={row.active ? "success" : "neutral"}
          label={row.active ? t("md.status.active") : t("md.status.inactive")}
        />
      ),
    },
  ];
}
