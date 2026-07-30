import type { ResourceDescriptor, SortField } from "./resource.types";
import type { FieldError } from "./validation";

/** Raw query params as they arrive on the list endpoint (all strings). */
export interface RawListQuery {
  readonly limit?: string;
  readonly cursor?: string;
  readonly sort?: string;
  readonly q?: string;
  readonly active?: string;
  /** Resource-specific equality filters, by param name. */
  readonly filters?: Readonly<Record<string, string>>;
}

/** A normalized, validated list query the repository can execute. */
export interface ParsedListQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly sort: { readonly field: SortField; readonly dir: "asc" | "desc" };
  readonly q?: string;
  /** `true` = active only, `false` = inactive only, `"all"` = no active filter. */
  readonly active: boolean | "all";
  /** Validated equality filters, keyed by Prisma field name. */
  readonly filters: Readonly<Record<string, string>>;
}

/** Parse `?sort=` (a leading `-` means descending), defaulting per descriptor. */
function parseSort(
  descriptor: ResourceDescriptor,
  raw: string | undefined,
): { sort?: ParsedListQuery["sort"]; error?: FieldError } {
  const value = raw ?? descriptor.defaultSort;
  const dir: "asc" | "desc" = value.startsWith("-") ? "desc" : "asc";
  const field = value.replace(/^-/, "");
  if (!descriptor.sortWhitelist.includes(field as SortField)) {
    return {
      error: {
        field: "sort",
        messages: [
          `sort must be one of: ${descriptor.sortWhitelist.join(", ")} (optionally -prefixed)`,
        ],
      },
    };
  }
  return { sort: { field: field as SortField, dir } };
}

/** Parse the `active` tri-state filter. */
function parseActive(raw: string | undefined): { active?: boolean | "all"; error?: FieldError } {
  if (raw === undefined) return { active: true };
  if (raw === "true") return { active: true };
  if (raw === "false") return { active: false };
  if (raw === "all") return { active: "all" };
  return { error: { field: "active", messages: ["active must be true, false, or all"] } };
}

/**
 * Validate + normalize the list query for a resource. Unknown filter params and
 * bad enum/sort values are rejected (api-conventions §6/§7); the caller renders
 * the returned errors into a `400 VALIDATION_FAILED`.
 */
export function parseListQuery(
  descriptor: ResourceDescriptor,
  raw: RawListQuery,
): { query?: ParsedListQuery; errors: FieldError[] } {
  const errors: FieldError[] = [];

  const { sort, error: sortError } = parseSort(descriptor, raw.sort);
  if (sortError !== undefined) errors.push(sortError);

  const { active, error: activeError } = parseActive(raw.active);
  if (activeError !== undefined) errors.push(activeError);

  const filters: Record<string, string> = {};
  const declared = descriptor.filters ?? [];
  const declaredByName = new Map(declared.map((f) => [f.name, f]));
  for (const [name, value] of Object.entries(raw.filters ?? {})) {
    const spec = declaredByName.get(name);
    if (spec === undefined) {
      errors.push({ field: name, messages: [`unknown filter ${name}`] });
      continue;
    }
    if (spec.kind === "enum" && spec.enumValues !== undefined && !spec.enumValues.includes(value)) {
      errors.push({
        field: name,
        messages: [`${name} must be one of: ${spec.enumValues.join(", ")}`],
      });
      continue;
    }
    filters[spec.field] = value;
  }

  if (errors.length > 0 || sort === undefined || active === undefined) {
    return { errors };
  }

  const query: ParsedListQuery = {
    ...(raw.limit !== undefined ? { limit: Number(raw.limit) } : {}),
    ...(raw.cursor !== undefined ? { cursor: raw.cursor } : {}),
    sort,
    ...(raw.q !== undefined && raw.q.trim().length > 0 ? { q: raw.q.trim() } : {}),
    active,
    filters,
  };
  return { query, errors };
}
