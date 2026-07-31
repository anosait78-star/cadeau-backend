import { apiFetch } from "@/lib/api-client";

/**
 * Client for `/v1/customers` (contract: docs/api/customers.md).
 *
 * The mask/full split the API enforces is mirrored here in the types: a list row
 * is a {@link CustomerListItem} and carries `phoneMasked` only — there is no
 * full-phone field on it to render by accident. The full number arrives with
 * {@link CustomerDetail}, from a single-customer read.
 */

/** Derived KPIs — read-only everywhere; `0`/`null` until EPIC-11 computes them. */
export interface CustomerKpis {
  readonly ordersCount: number;
  /** Lifetime spend in integer minor units. */
  readonly totalSpent: number;
  readonly lastOrderAt: string | null;
}

/** A customer as a list row: masked phone, never the full value. */
export interface CustomerListItem extends CustomerKpis {
  readonly id: string;
  readonly name: string;
  /** e.g. `+2010•••4567`. */
  readonly phoneMasked: string;
  readonly email: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A customer delivery address. */
export interface CustomerAddress {
  readonly id: string;
  readonly customerId: string;
  readonly line: string;
  readonly landmark: string | null;
  readonly notes: string | null;
  readonly governorateId: string | null;
  readonly isDefault: boolean;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A single customer read: the full phone plus the addresses. */
export interface CustomerDetail extends CustomerKpis {
  readonly id: string;
  readonly name: string;
  /** The full E.164 number — only ever returned by a single-customer read. */
  readonly phone: string;
  readonly email: string | null;
  readonly notes: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly addresses: CustomerAddress[];
}

/** A keyset page of customers (api-conventions §5). */
export interface CustomerPage {
  readonly data: CustomerListItem[];
  readonly page: {
    readonly limit: number;
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

/** Query options for the customers list. */
export interface ListOptions {
  readonly cursor?: string;
  /** `true` = active only, `false` = archived only, `"all"` = both. */
  readonly active?: boolean | "all";
  /**
   * Exact phone (E.164) **or** a name/email term — the server decides which by
   * trying to normalize it. A partial phone matches nothing: the phone is stored
   * as a blind index (docs/privacy-model.md §5).
   */
  readonly q?: string;
  readonly governorateId?: string;
}

function buildQuery(options: ListOptions): string {
  const params = new URLSearchParams();
  if (options.cursor !== undefined) params.set("cursor", options.cursor);
  if (options.active !== undefined) params.set("active", String(options.active));
  if (options.q !== undefined && options.q.length > 0) params.set("q", options.q);
  if (options.governorateId !== undefined) params.set("governorateId", options.governorateId);
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : "";
}

/** Create/update customer body. Send `null` to clear an optional field. */
export interface CustomerInput {
  readonly name?: string;
  /** Any common form; the server normalizes it to E.164. */
  readonly phone?: string;
  readonly email?: string | null;
  readonly notes?: string | null;
}

/** Create/update address body. */
export interface AddressInput {
  readonly line?: string;
  readonly landmark?: string | null;
  readonly notes?: string | null;
  readonly governorateId?: string | null;
  readonly isDefault?: boolean;
  readonly active?: boolean;
}

/** `GET /v1/customers` — keyset-paginated customers, masked phones. */
export function listCustomers(options: ListOptions = {}): Promise<CustomerPage> {
  return apiFetch<CustomerPage>(`/customers${buildQuery(options)}`);
}

/** `GET /v1/customers/{id}` — full phone, KPIs and addresses. */
export function getCustomer(id: string): Promise<CustomerDetail> {
  return apiFetch<CustomerDetail>(`/customers/${id}`);
}

/** `POST /v1/customers` — create a customer. */
export function createCustomer(body: CustomerInput): Promise<CustomerDetail> {
  return apiFetch<CustomerDetail>("/customers", { method: "POST", body });
}

/** `PATCH /v1/customers/{id}` — update a customer. */
export function updateCustomer(id: string, body: CustomerInput): Promise<CustomerDetail> {
  return apiFetch<CustomerDetail>(`/customers/${id}`, { method: "PATCH", body });
}

/** `DELETE /v1/customers/{id}` — archive a customer (soft-delete). */
export function archiveCustomer(id: string): Promise<void> {
  return apiFetch<void>(`/customers/${id}`, { method: "DELETE" });
}

/** `GET /v1/customers/{id}/addresses` — a customer's addresses. */
export function listAddresses(customerId: string): Promise<{ data: CustomerAddress[] }> {
  return apiFetch<{ data: CustomerAddress[] }>(`/customers/${customerId}/addresses`);
}

/** `POST /v1/customers/{id}/addresses` — add an address. */
export function createAddress(customerId: string, body: AddressInput): Promise<CustomerAddress> {
  return apiFetch<CustomerAddress>(`/customers/${customerId}/addresses`, { method: "POST", body });
}

/** `PATCH /v1/customers/{id}/addresses/{addressId}` — update an address. */
export function updateAddress(
  customerId: string,
  addressId: string,
  body: AddressInput,
): Promise<CustomerAddress> {
  return apiFetch<CustomerAddress>(`/customers/${customerId}/addresses/${addressId}`, {
    method: "PATCH",
    body,
  });
}
