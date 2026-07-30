import { apiFetch } from "@/lib/api-client";

/** A master-data row: four common fields plus resource-specific attributes. */
export interface MasterDataItem {
  readonly id: string;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly [attribute: string]: unknown;
}

/** A keyset page of master-data rows (api-conventions §5). */
export interface MasterDataPage {
  readonly data: MasterDataItem[];
  readonly page: {
    readonly limit: number;
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

/** Query options for a list request. */
export interface ListOptions {
  readonly cursor?: string;
  /** `true` = active only, `false` = inactive only, `"all"` = both. */
  readonly active?: boolean | "all";
  readonly q?: string;
  /** Resource-specific equality filters. */
  readonly filters?: Readonly<Record<string, string>>;
}

function buildQuery(options: ListOptions): string {
  const params = new URLSearchParams();
  if (options.cursor !== undefined) params.set("cursor", options.cursor);
  if (options.active !== undefined) params.set("active", String(options.active));
  if (options.q !== undefined && options.q.length > 0) params.set("q", options.q);
  for (const [key, value] of Object.entries(options.filters ?? {})) params.set(key, value);
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : "";
}

/** `GET /v1/master-data/{resource}` — keyset-paginated rows. */
export function listItems(resource: string, options: ListOptions = {}): Promise<MasterDataPage> {
  return apiFetch<MasterDataPage>(`/master-data/${resource}${buildQuery(options)}`);
}

/** `POST /v1/master-data/{resource}` — create a tenant row. */
export function createItem(
  resource: string,
  body: Record<string, unknown>,
): Promise<MasterDataItem> {
  return apiFetch<MasterDataItem>(`/master-data/${resource}`, { method: "POST", body });
}

/** `PATCH /v1/master-data/{resource}/{id}` — update a tenant row. */
export function updateItem(
  resource: string,
  id: string,
  body: Record<string, unknown>,
): Promise<MasterDataItem> {
  return apiFetch<MasterDataItem>(`/master-data/${resource}/${id}`, { method: "PATCH", body });
}

/** `DELETE /v1/master-data/{resource}/{id}` — soft-delete (deactivate). */
export function deactivateItem(resource: string, id: string): Promise<void> {
  return apiFetch<void>(`/master-data/${resource}/${id}`, { method: "DELETE" });
}
