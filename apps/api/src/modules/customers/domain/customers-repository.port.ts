import type { KeysetPage } from "@cadeau/database";
import type {
  CustomerAddressView,
  CustomerListView,
  CustomerView,
  CustomerWithAddresses,
  CustomerWriteResult,
} from "./customer.entity";
import type { ParsedCustomerListQuery } from "./list-query";

/** The tenant + acting member for a write. */
export interface WriteActor {
  readonly companyId: string;
  readonly actorId: string;
}

/**
 * Fields accepted when creating a customer.
 *
 * `phone` is the **plaintext E.164** value: the repository owns turning it into
 * the stored pair (ciphertext + blind index), because how a sensitive value is
 * persisted is a persistence concern. Nothing above this port ever sees a hash.
 *
 * The derived KPIs (`ordersCount`, `totalSpent`, `lastOrderAt`) are absent by
 * design — there is no write path for them at any layer until EPIC-11.
 */
export interface CreateCustomerInput {
  readonly name: string;
  /** Normalized E.164, e.g. `+201001234567`. */
  readonly phone: string;
  readonly email?: string | null;
  readonly notes?: string | null;
  /** Optional `Idempotency-Key`; a retry replays instead of duplicating. */
  readonly idempotencyKey?: string | null;
}

/** Partial update for a customer; omitted keys are left unchanged. */
export interface UpdateCustomerInput {
  readonly name?: string;
  /** Normalized E.164. Changing it re-derives both stored columns. */
  readonly phone?: string;
  readonly email?: string | null;
  readonly notes?: string | null;
}

/** Fields accepted when creating an address. */
export interface CreateAddressInput {
  readonly line: string;
  readonly landmark?: string | null;
  readonly notes?: string | null;
  readonly governorateId?: string | null;
  readonly isDefault?: boolean;
}

/** Partial update for an address. */
export interface UpdateAddressInput {
  readonly line?: string;
  readonly landmark?: string | null;
  readonly notes?: string | null;
  readonly governorateId?: string | null;
  readonly isDefault?: boolean;
  readonly active?: boolean;
}

/**
 * Port for reading/writing customers and their addresses (EPIC-10). The Prisma
 * adapter binds the tenant under RLS for every unit of work (the app-layer half
 * of the two-layer isolation model) and owns the PII round-trip: plaintext in,
 * ciphertext + blind index stored, plaintext (or a mask) out.
 *
 * Uniqueness violations surface as {@link DuplicateCustomerError}; a bad tenant
 * reference as {@link ReferenceNotFoundError}; a bad cursor as
 * {@link InvalidListCursorError}. Not-found reads/writes return `null`.
 */
export interface CustomersRepositoryPort {
  /** A page of customers. Rows carry a **masked** phone — never the full value. */
  list(companyId: string, query: ParsedCustomerListQuery): Promise<KeysetPage<CustomerListView>>;

  /** A customer with its addresses, or `null` if absent in this tenant. */
  findById(companyId: string, id: string): Promise<CustomerWithAddresses | null>;

  /**
   * Create a customer. When `idempotencyKey` is set and already used by this
   * company, the stored row is returned with `replayed: true` and nothing is
   * written — including on the concurrent race, where the loser of the unique
   * index replays the winner's row rather than failing.
   */
  create(actor: WriteActor, data: CreateCustomerInput): Promise<CustomerWriteResult>;

  update(actor: WriteActor, id: string, data: UpdateCustomerInput): Promise<CustomerView | null>;

  /** Archive a customer (`is_active = false`). Returns the row, or `null` if absent. */
  archive(actor: WriteActor, id: string): Promise<CustomerView | null>;

  /** The addresses of a customer, or `null` if the customer is absent. */
  listAddresses(
    companyId: string,
    customerId: string,
  ): Promise<readonly CustomerAddressView[] | null>;

  createAddress(
    actor: WriteActor,
    customerId: string,
    data: CreateAddressInput,
  ): Promise<CustomerAddressView | null>;

  updateAddress(
    actor: WriteActor,
    customerId: string,
    addressId: string,
    data: UpdateAddressInput,
  ): Promise<CustomerAddressView | null>;
}

/** DI token for {@link CustomersRepositoryPort}. */
export const CUSTOMERS_REPOSITORY = Symbol("CUSTOMERS_REPOSITORY");
