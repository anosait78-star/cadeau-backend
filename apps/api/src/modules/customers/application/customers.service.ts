import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppErrors, AppException } from "../../../shared/errors/app-exception";
import { EVENT_BUS, type EventBusPort } from "../../../shared/events/event-bus.port";
import { CLOCK, type Clock } from "../../../shared/time/clock";
import type {
  CustomerAddressView,
  CustomerListView,
  CustomerView,
  CustomerWithAddresses,
} from "../domain/customer.entity";
import { CUSTOMERS_AUDIT, type CustomersAuditPort } from "../domain/customers-audit.port";
import {
  CUSTOMERS_REPOSITORY,
  type CreateAddressInput,
  type CustomersRepositoryPort,
  type UpdateAddressInput,
  type WriteActor,
} from "../domain/customers-repository.port";
import {
  DuplicateCustomerError,
  InvalidListCursorError,
  InvalidPhoneError,
  ReferenceNotFoundError,
} from "../domain/customers.errors";
import { parseCustomerListQuery, type RawCustomerListQuery } from "../domain/list-query";
import { normalizeE164 } from "../domain/phone";

/** What the service accepts when creating a customer (phone still un-normalized). */
export interface CreateCustomerCommand {
  readonly name: string;
  /** As typed by the caller; normalized here before it reaches the repository. */
  readonly phone: string;
  readonly email?: string | null;
  readonly notes?: string | null;
  readonly idempotencyKey?: string | null;
}

/** Partial update; omitted keys are left unchanged. */
export interface UpdateCustomerCommand {
  readonly name?: string;
  readonly phone?: string;
  readonly email?: string | null;
  readonly notes?: string | null;
}

/**
 * Orchestrates the customers module (EPIC-10). It enforces the tenant scope
 * (every operation requires an active company), **normalizes the phone before
 * anything is stored or hashed**, delegates persistence to the repository, and
 * on every write records a durable audit row and emits the matching `customer.*`
 * event. Access is gated by the controller's `@RequireCapability`; this service
 * assumes an authorized caller.
 *
 * Two rules specific to this module:
 *
 * - **An idempotent replay writes nothing** — no audit row, no event — because
 *   nothing changed (the EPIC-9 contract).
 * - **Nothing personal leaves this class in an audit row or an event payload**:
 *   both carry ids and field *names* only (docs/privacy-model.md §6).
 */
@Injectable()
export class CustomersService {
  constructor(
    @Inject(CUSTOMERS_REPOSITORY) private readonly repo: CustomersRepositoryPort,
    @Inject(CUSTOMERS_AUDIT) private readonly audit: CustomersAuditPort,
    @Inject(EVENT_BUS) private readonly events: EventBusPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(
    principal: RequestPrincipal,
    rawQuery: RawCustomerListQuery,
  ): Promise<KeysetPage<CustomerListView>> {
    const companyId = this.requireTenant(principal);
    const { query, errors } = parseCustomerListQuery(rawQuery);
    if (query === undefined) {
      throw AppErrors.validation("Request validation failed", errors);
    }
    try {
      return await this.repo.list(companyId, query);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async getOne(principal: RequestPrincipal, id: string): Promise<CustomerWithAddresses> {
    const companyId = this.requireTenant(principal);
    const customer = await this.repo.findById(companyId, id);
    if (customer === null) throw AppErrors.notFound("Customer not found.");
    return customer;
  }

  async create(
    principal: RequestPrincipal,
    data: CreateCustomerCommand,
  ): Promise<{ customer: CustomerView; replayed: boolean }> {
    const companyId = this.requireTenant(principal);
    const phone = this.requireE164(data.phone);
    const actor: WriteActor = { companyId, actorId: principal.userId };

    let result;
    try {
      result = await this.repo.create(actor, {
        name: data.name,
        phone,
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.idempotencyKey !== undefined ? { idempotencyKey: data.idempotencyKey } : {}),
      });
    } catch (error) {
      throw this.mapError(error);
    }

    // A replay moved nothing, so it is not a change: no audit row, no event.
    if (!result.replayed) {
      await this.record(companyId, principal.userId, {
        action: "customer.created",
        entityType: "customer",
        entityId: result.customer.id,
      });
      await this.events.publish({
        type: "customer.created",
        companyId,
        actorId: principal.userId,
        occurredAt: this.clock.now(),
        payload: { customerId: result.customer.id },
      });
    }
    return result;
  }

  async update(
    principal: RequestPrincipal,
    id: string,
    data: UpdateCustomerCommand,
  ): Promise<CustomerView> {
    const companyId = this.requireTenant(principal);
    const phone = data.phone === undefined ? undefined : this.requireE164(data.phone);

    let row: CustomerView | null;
    try {
      row = await this.repo.update({ companyId, actorId: principal.userId }, id, {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      });
    } catch (error) {
      throw this.mapError(error);
    }
    if (row === null) throw AppErrors.notFound("Customer not found.");

    const fields = this.changedFields(data);
    await this.record(companyId, principal.userId, {
      action: "customer.updated",
      entityType: "customer",
      entityId: row.id,
      changes: { fields },
    });
    await this.events.publish({
      type: "customer.updated",
      companyId,
      actorId: principal.userId,
      occurredAt: this.clock.now(),
      payload: { customerId: row.id, fields },
    });
    return row;
  }

  async archive(principal: RequestPrincipal, id: string): Promise<void> {
    const companyId = this.requireTenant(principal);
    const row = await this.repo.archive({ companyId, actorId: principal.userId }, id);
    if (row === null) throw AppErrors.notFound("Customer not found.");
    await this.record(companyId, principal.userId, {
      action: "customer.archived",
      entityType: "customer",
      entityId: row.id,
    });
    await this.events.publish({
      type: "customer.updated",
      companyId,
      actorId: principal.userId,
      occurredAt: this.clock.now(),
      payload: { customerId: row.id, fields: ["active"] },
    });
  }

  async listAddresses(
    principal: RequestPrincipal,
    customerId: string,
  ): Promise<readonly CustomerAddressView[]> {
    const companyId = this.requireTenant(principal);
    const addresses = await this.repo.listAddresses(companyId, customerId);
    if (addresses === null) throw AppErrors.notFound("Customer not found.");
    return addresses;
  }

  async createAddress(
    principal: RequestPrincipal,
    customerId: string,
    data: CreateAddressInput,
  ): Promise<CustomerAddressView> {
    const companyId = this.requireTenant(principal);
    let address: CustomerAddressView | null;
    try {
      address = await this.repo.createAddress(
        { companyId, actorId: principal.userId },
        customerId,
        data,
      );
    } catch (error) {
      throw this.mapError(error);
    }
    if (address === null) throw AppErrors.notFound("Customer not found.");
    await this.record(companyId, principal.userId, {
      action: "customer.address_created",
      entityType: "customer_address",
      entityId: address.id,
    });
    await this.emitCustomerUpdated(companyId, principal.userId, customerId, ["addresses"]);
    return address;
  }

  async updateAddress(
    principal: RequestPrincipal,
    customerId: string,
    addressId: string,
    data: UpdateAddressInput,
  ): Promise<CustomerAddressView> {
    const companyId = this.requireTenant(principal);
    let address: CustomerAddressView | null;
    try {
      address = await this.repo.updateAddress(
        { companyId, actorId: principal.userId },
        customerId,
        addressId,
        data,
      );
    } catch (error) {
      throw this.mapError(error);
    }
    if (address === null) throw AppErrors.notFound("Address not found.");
    await this.record(companyId, principal.userId, {
      action: "customer.address_updated",
      entityType: "customer_address",
      entityId: address.id,
      changes: { fields: Object.keys(data) },
    });
    await this.emitCustomerUpdated(companyId, principal.userId, customerId, ["addresses"]);
    return address;
  }

  // ---- internals -----------------------------------------------------------

  private async emitCustomerUpdated(
    companyId: string,
    actorId: string,
    customerId: string,
    fields: readonly string[],
  ): Promise<void> {
    await this.events.publish({
      type: "customer.updated",
      companyId,
      actorId,
      occurredAt: this.clock.now(),
      payload: { customerId, fields },
    });
  }

  private async record(
    companyId: string,
    actorId: string,
    entry: {
      action:
        | "customer.created"
        | "customer.updated"
        | "customer.archived"
        | "customer.address_created"
        | "customer.address_updated";
      entityType: "customer" | "customer_address";
      entityId: string;
      changes?: unknown;
    },
  ): Promise<void> {
    await this.audit.record({ companyId, actorId, ...entry });
  }

  /**
   * The names of the fields a patch touched — never their values. Sorted so the
   * audit row and the event payload read the same regardless of the order the
   * caller happened to serialize the request body in.
   */
  private changedFields(data: UpdateCustomerCommand): readonly string[] {
    return Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key)
      .sort();
  }

  /**
   * Normalize to E.164 or reject. This is the single gate in front of the blind
   * index: an un-normalized value would hash differently and slip past the
   * unique index that enforces "one customer per phone".
   */
  private requireE164(raw: string): string {
    const normalized = normalizeE164(raw);
    if (normalized === null) throw this.mapError(new InvalidPhoneError());
    return normalized;
  }

  private requireTenant(principal: RequestPrincipal): string {
    if (principal.companyId === null) {
      throw AppErrors.forbidden("Select an active company first.");
    }
    return principal.companyId;
  }

  private mapError(error: unknown): unknown {
    if (error instanceof DuplicateCustomerError) {
      return AppErrors.conflict(error.message, [{ field: error.field, messages: [error.message] }]);
    }
    if (error instanceof ReferenceNotFoundError || error instanceof InvalidPhoneError) {
      return new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "UNPROCESSABLE_ENTITY",
        error.message,
        [{ field: error.field, messages: [error.message] }],
      );
    }
    if (error instanceof InvalidListCursorError) {
      return AppErrors.badRequest(error.message);
    }
    return error;
  }
}
