import type { ResourceDescriptor } from "./resource.types";

/**
 * The master-data resource registry (EPIC-7) — the single place the eight
 * reference collections are declared. Three are SYSTEM reference (read-only via
 * the API, seeded): currencies, country-configs, governorates. Five are
 * TENANT-editable CRUD: units, product-categories, order-labels, order-reasons,
 * shipping-zones. The generic engine reads these descriptors; nothing else in
 * the module hard-codes a resource.
 */
export const RESOURCES: readonly ResourceDescriptor[] = [
  // ---- System reference (read-only via API) --------------------------------
  {
    name: "currencies",
    model: "currency",
    scope: "system",
    idField: "code",
    clientProvidesId: true,
    idSpec: { name: "code", kind: "string", required: true, minLength: 3, maxLength: 3 },
    fields: [
      { name: "name", kind: "string", required: true, maxLength: 64 },
      { name: "symbol", kind: "string", required: true, maxLength: 8 },
      { name: "decimalDigits", kind: "int", min: 0, max: 6 },
    ],
    searchable: ["code", "name"],
    sortWhitelist: ["name", "createdAt"],
    defaultSort: "name",
  },
  {
    name: "country-configs",
    model: "countryConfig",
    scope: "system",
    idField: "code",
    clientProvidesId: true,
    idSpec: { name: "code", kind: "string", required: true, minLength: 2, maxLength: 2 },
    fields: [
      { name: "name", kind: "string", required: true, maxLength: 64 },
      { name: "defaultCurrencyCode", kind: "string", required: true, minLength: 3, maxLength: 3 },
      { name: "phoneCode", kind: "string", required: true, maxLength: 8 },
    ],
    searchable: ["code", "name"],
    sortWhitelist: ["name", "createdAt"],
    defaultSort: "name",
  },
  {
    name: "governorates",
    model: "governorate",
    scope: "system",
    idField: "id",
    clientProvidesId: false,
    fields: [
      { name: "countryCode", kind: "string", required: true, minLength: 2, maxLength: 2 },
      { name: "name", kind: "string", required: true, maxLength: 128 },
    ],
    searchable: ["name"],
    sortWhitelist: ["name", "createdAt"],
    defaultSort: "name",
    filters: [{ name: "countryCode", field: "countryCode", kind: "string" }],
  },

  // ---- Tenant-editable CRUD ------------------------------------------------
  {
    name: "units",
    model: "unit",
    scope: "tenant",
    idField: "id",
    clientProvidesId: false,
    fields: [
      { name: "name", kind: "string", required: true, maxLength: 64 },
      { name: "code", kind: "string", nullable: true, maxLength: 16 },
    ],
    searchable: ["name", "code"],
    sortWhitelist: ["name", "createdAt"],
    defaultSort: "name",
  },
  {
    name: "product-categories",
    model: "productCategory",
    scope: "tenant",
    idField: "id",
    clientProvidesId: false,
    fields: [
      { name: "name", kind: "string", required: true, maxLength: 128 },
      { name: "parentId", kind: "uuid", nullable: true, tenantRefModel: "productCategory" },
    ],
    searchable: ["name"],
    sortWhitelist: ["name", "createdAt"],
    defaultSort: "name",
    filters: [{ name: "parentId", field: "parentId", kind: "uuid" }],
  },
  {
    name: "order-labels",
    model: "orderLabel",
    scope: "tenant",
    idField: "id",
    clientProvidesId: false,
    fields: [
      { name: "name", kind: "string", required: true, maxLength: 64 },
      { name: "color", kind: "color", nullable: true },
    ],
    searchable: ["name"],
    sortWhitelist: ["name", "createdAt"],
    defaultSort: "name",
  },
  {
    name: "order-reasons",
    model: "orderReason",
    scope: "tenant",
    idField: "id",
    clientProvidesId: false,
    fields: [
      { name: "name", kind: "string", required: true, maxLength: 128 },
      {
        name: "kind",
        kind: "enum",
        enumValues: ["cancellation", "return", "general"],
      },
    ],
    searchable: ["name"],
    sortWhitelist: ["name", "createdAt"],
    defaultSort: "name",
    filters: [
      {
        name: "kind",
        field: "kind",
        kind: "enum",
        enumValues: ["cancellation", "return", "general"],
      },
    ],
  },
  {
    name: "whatsapp-templates",
    model: "whatsappTemplate",
    scope: "tenant",
    idField: "id",
    clientProvidesId: false,
    fields: [
      { name: "name", kind: "string", required: true, maxLength: 128 },
      { name: "body", kind: "string", required: true, maxLength: 2000 },
    ],
    searchable: ["name"],
    sortWhitelist: ["name", "createdAt"],
    defaultSort: "name",
  },
  {
    name: "shipping-zones",
    model: "shippingZone",
    scope: "tenant",
    idField: "id",
    clientProvidesId: false,
    fields: [
      { name: "name", kind: "string", required: true, maxLength: 128 },
      { name: "countryCode", kind: "string", nullable: true, minLength: 2, maxLength: 2 },
    ],
    searchable: ["name"],
    sortWhitelist: ["name", "createdAt"],
    defaultSort: "name",
    filters: [{ name: "countryCode", field: "countryCode", kind: "string" }],
  },
];

/** Every resource name (URL segments), for OpenAPI + validation messages. */
export const RESOURCE_NAMES: readonly string[] = RESOURCES.map((r) => r.name);

const BY_NAME = new Map<string, ResourceDescriptor>(RESOURCES.map((r) => [r.name, r]));

/** Look a resource up by its URL segment, or `undefined` if unknown. */
export function findResource(name: string): ResourceDescriptor | undefined {
  return BY_NAME.get(name);
}
