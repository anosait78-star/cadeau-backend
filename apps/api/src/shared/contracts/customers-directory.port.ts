import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../auth/authenticated-request";

export interface DirectoryCustomer {
  readonly id: string;
}

export interface CustomerLookupFilter {
  readonly q?: string;
  readonly limit?: string;
}

export interface CreateCustomerCommand {
  readonly name: string;
  readonly phone: string;
  readonly email?: string | null;
}

/**
 * A storefront's own free-text delivery address (storefront-address-sync).
 * `rawCity`/`rawState` are kept verbatim for staff review even when they
 * can't be matched to a governorate — matching is exact-string only (the
 * storefront's governorate dropdown is a closed, known list), never fuzzy.
 */
export interface SyncAddressCommand {
  readonly line: string;
  readonly rawCity?: string;
  readonly rawState?: string;
}

/**
 * Shared cross-feature contract for finding/creating a customer by phone (and
 * syncing their storefront-reported address). The customers feature
 * implements it (`CustomersService` structurally satisfies this shape,
 * reusing its existing E.164 normalization + blind-index find/create path);
 * storefront-integration consumes it instead of importing `customers`
 * directly (architecture rule `no-cross-feature-imports`).
 */
export interface CustomersDirectoryPort {
  list(
    principal: RequestPrincipal,
    query: CustomerLookupFilter,
  ): Promise<KeysetPage<DirectoryCustomer>>;
  create(
    principal: RequestPrincipal,
    data: CreateCustomerCommand,
  ): Promise<{ customer: DirectoryCustomer; replayed: boolean }>;
  /**
   * Keep the customer's default address in step with their latest storefront
   * order. The same address again is a no-op; a different one becomes a NEW
   * default and the previous one — staff-edited ("manual") included, by
   * decision on 2026-09-13 — is kept, demoted, as history. Never throws on an
   * unmatched/missing governorate. Swallow-and-log any failure at the call
   * site: an address-sync problem must never fail the order it rode in on.
   */
  upsertStorefrontAddress(
    principal: RequestPrincipal,
    customerId: string,
    data: SyncAddressCommand,
  ): Promise<void>;
  /**
   * Rename the customer after their latest storefront order (2026-09-13). The
   * caller passes the BILLING name only: on a gift order the shipping name is
   * the recipient, and using it would rename the buyer after whoever they last
   * sent something to. A blank or unchanged name is a no-op. Swallow-and-log
   * failures at the call site, as with the address.
   */
  renameFromStorefront(
    principal: RequestPrincipal,
    customerId: string,
    name: string,
  ): Promise<void>;
}

/** DI token for {@link CustomersDirectoryPort}. */
export const CUSTOMERS_DIRECTORY = Symbol("CUSTOMERS_DIRECTORY");
