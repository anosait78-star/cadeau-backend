/**
 * The master-data engine's resource vocabulary (EPIC-7). Every reference
 * collection is described by data — a {@link ResourceDescriptor} — and the
 * generic repository/service/controller act on that description, so adding a
 * resource is a registry entry, never new plumbing (ADR-004 spirit).
 */

/** The kind of a writable attribute, used for validation + query building. */
export type FieldKind = "string" | "boolean" | "int" | "enum" | "uuid" | "color";

/** A writable attribute on a resource (beyond the id, `active`, and base columns). */
export interface FieldSpec {
  /** camelCase attribute name — also the Prisma field name. */
  readonly name: string;
  readonly kind: FieldKind;
  /** Required on create. Default false. */
  readonly required?: boolean;
  /** Settable on update. Default true. */
  readonly updatable?: boolean;
  /** May be explicitly set to null (create/update). Default false. */
  readonly nullable?: boolean;
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly enumValues?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  /**
   * When set, a uuid value must reference an existing row of this Prisma model
   * within the SAME tenant (verified under the tenant RLS context). Guards
   * self-references like a category's parent from pointing across tenants.
   */
  readonly tenantRefModel?: string;
}

/** A resource-specific equality filter accepted on the list endpoint. */
export interface FilterSpec {
  /** camelCase query-param name (api-conventions §6). */
  readonly name: string;
  /** The Prisma field it filters. */
  readonly field: string;
  readonly kind: FieldKind;
  readonly enumValues?: readonly string[];
}

/** A sort field a resource exposes (always paired with a unique tie-breaker). */
export type SortField = "name" | "createdAt";

/**
 * A full description of one master-data collection. `scope` decides isolation:
 * `system` rows are shared reference data (read-only via the API, seeded), while
 * `tenant` rows are per-company and CRUD-able.
 */
export interface ResourceDescriptor {
  /** URL segment + event `resource` value — kebab plural (e.g. `order-labels`). */
  readonly name: string;
  /** Prisma delegate key (camelCase model, e.g. `orderLabel`). */
  readonly model: string;
  readonly scope: "system" | "tenant";
  /** The primary key field name exposed as `id` in output. */
  readonly idField: "id" | "code";
  /** True for code-keyed tables where the client supplies the id on create. */
  readonly clientProvidesId: boolean;
  /** Validation for the client-provided id (only when clientProvidesId). */
  readonly idSpec?: FieldSpec;
  /** Writable attributes (excludes id, `active`, and base columns). */
  readonly fields: readonly FieldSpec[];
  /** Fields the free-text `q` search matches (substring, case-insensitive). */
  readonly searchable: readonly string[];
  /** Sort fields accepted on `?sort=` (a leading `-` means descending). */
  readonly sortWhitelist: readonly SortField[];
  /** Default sort applied when `?sort=` is omitted (e.g. `name`, `-createdAt`). */
  readonly defaultSort: string;
  /** Resource-specific equality filters. */
  readonly filters?: readonly FilterSpec[];
}

/** A resource row as read from the database (only the selected output columns). */
export type ResourceRow = Record<string, unknown>;

/** The public view of a resource row (api-conventions shape). */
export interface ResourceView {
  readonly id: string;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The resource-specific attributes. */
  readonly [attribute: string]: unknown;
}
