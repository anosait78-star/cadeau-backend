import type { TranslationKey } from "@/i18n/dictionaries";

/** A field rendered in the table and (for editable resources) the form. */
export interface MdField {
  /** Attribute name on the row / request body. */
  readonly name: string;
  readonly labelKey: TranslationKey;
  readonly type: "text" | "select";
  /** Options for a select field; also used to render the value label. */
  readonly options?: readonly string[];
  /** Required on create. */
  readonly required?: boolean;
}

/** A resource-specific equality filter surfaced in the toolbar. */
export interface MdFilter {
  readonly name: string;
  readonly labelKey: TranslationKey;
  readonly options: readonly string[];
}

/** Client-side description of a master-data collection (labels + fields). */
export interface MdResource {
  /** URL segment (matches the backend registry). */
  readonly name: string;
  readonly labelKey: TranslationKey;
  /** System reference resources are read-only; tenant resources are editable. */
  readonly editable: boolean;
  readonly fields: readonly MdField[];
  readonly filters?: readonly MdFilter[];
}

const ORDER_REASON_KINDS = ["cancellation", "return", "general"] as const;

/**
 * The eight master-data collections, mirroring the backend registry. The first
 * three are system reference (read-only); the rest are tenant-editable. Field
 * lists drive both the table columns and the create/edit form.
 */
export const MD_RESOURCES: readonly MdResource[] = [
  {
    name: "units",
    labelKey: "md.resource.units",
    editable: true,
    fields: [
      { name: "name", labelKey: "md.field.name", type: "text", required: true },
      { name: "code", labelKey: "md.field.code", type: "text" },
    ],
  },
  {
    name: "product-categories",
    labelKey: "md.resource.productCategories",
    editable: true,
    fields: [{ name: "name", labelKey: "md.field.name", type: "text", required: true }],
  },
  {
    name: "order-labels",
    labelKey: "md.resource.orderLabels",
    editable: true,
    fields: [
      { name: "name", labelKey: "md.field.name", type: "text", required: true },
      { name: "color", labelKey: "md.field.color", type: "text" },
    ],
  },
  {
    name: "order-reasons",
    labelKey: "md.resource.orderReasons",
    editable: true,
    fields: [
      { name: "name", labelKey: "md.field.name", type: "text", required: true },
      { name: "kind", labelKey: "md.field.kind", type: "select", options: ORDER_REASON_KINDS },
    ],
    filters: [{ name: "kind", labelKey: "md.field.kind", options: ORDER_REASON_KINDS }],
  },
  {
    name: "shipping-zones",
    labelKey: "md.resource.shippingZones",
    editable: true,
    fields: [
      { name: "name", labelKey: "md.field.name", type: "text", required: true },
      { name: "countryCode", labelKey: "md.field.countryCode", type: "text" },
    ],
  },
  {
    name: "currencies",
    labelKey: "md.resource.currencies",
    editable: false,
    fields: [
      { name: "name", labelKey: "md.field.name", type: "text" },
      { name: "symbol", labelKey: "md.field.symbol", type: "text" },
      { name: "decimalDigits", labelKey: "md.field.decimalDigits", type: "text" },
    ],
  },
  {
    name: "country-configs",
    labelKey: "md.resource.countryConfigs",
    editable: false,
    fields: [
      { name: "name", labelKey: "md.field.name", type: "text" },
      { name: "defaultCurrencyCode", labelKey: "md.field.defaultCurrencyCode", type: "text" },
      { name: "phoneCode", labelKey: "md.field.phoneCode", type: "text" },
    ],
  },
  {
    name: "governorates",
    labelKey: "md.resource.governorates",
    editable: false,
    fields: [
      { name: "name", labelKey: "md.field.name", type: "text" },
      { name: "countryCode", labelKey: "md.field.countryCode", type: "text" },
    ],
  },
];

/** Look a client resource up by URL segment. */
export function findMdResource(name: string): MdResource | undefined {
  return MD_RESOURCES.find((r) => r.name === name);
}
