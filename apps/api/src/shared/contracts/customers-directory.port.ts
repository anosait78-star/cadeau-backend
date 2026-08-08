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
 * Shared cross-feature contract for finding/creating a customer by phone. The
 * customers feature implements it (`CustomersService` structurally satisfies
 * this shape, reusing its existing E.164 normalization + blind-index
 * find/create path); storefront-integration consumes it instead of importing
 * `customers` directly (architecture rule `no-cross-feature-imports`).
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
}

/** DI token for {@link CustomersDirectoryPort}. */
export const CUSTOMERS_DIRECTORY = Symbol("CUSTOMERS_DIRECTORY");
