import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppErrors, AppException } from "../../../shared/errors/app-exception";
import { EVENT_BUS, type EventBusPort } from "../../../shared/events/event-bus.port";
import { CLOCK, type Clock } from "../../../shared/time/clock";
import type { RawListQuery } from "../domain/list-query";
import { parseListQuery } from "../domain/list-query";
import { MASTER_DATA_AUDIT, type MasterDataAuditPort } from "../domain/master-data-audit.port";
import {
  MASTER_DATA_REPOSITORY,
  type MasterDataRepositoryPort,
} from "../domain/master-data-repository.port";
import {
  DuplicateResourceError,
  InvalidListCursorError,
  ReferenceNotFoundError,
} from "../domain/master-data.errors";
import { findResource } from "../domain/resource-registry";
import type { ResourceDescriptor, ResourceView } from "../domain/resource.types";
import { validateCreate, validateUpdate } from "../domain/validation";
import { MasterDataCache } from "./master-data-cache";

/**
 * Orchestrates the master-data engine: it resolves the resource descriptor,
 * validates input, enforces the system/tenant scope rule (system reference data
 * is read-only via the API), and on every write records a durable audit row,
 * invalidates the reference cache, and emits `master_data.changed` so consumers
 * refresh. Access is gated by the controller's `@RequireCapability`; this service
 * assumes an authorized caller.
 */
@Injectable()
export class MasterDataService {
  constructor(
    @Inject(MASTER_DATA_REPOSITORY) private readonly repo: MasterDataRepositoryPort,
    @Inject(MASTER_DATA_AUDIT) private readonly audit: MasterDataAuditPort,
    @Inject(EVENT_BUS) private readonly events: EventBusPort,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly cache: MasterDataCache,
  ) {}

  /** List a resource (keyset, filtered, sorted). */
  async list(
    principal: RequestPrincipal,
    resourceName: string,
    rawQuery: RawListQuery,
  ): Promise<KeysetPage<ResourceView>> {
    const descriptor = this.resolve(resourceName);
    const companyId = this.scopeCompanyId(descriptor, principal);
    const { query, errors } = parseListQuery(descriptor, rawQuery);
    if (query === undefined) {
      throw AppErrors.validation("Request validation failed", errors);
    }
    try {
      return await this.repo.list(descriptor, companyId, query);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /** Read one row by id, or `404`. */
  async getOne(
    principal: RequestPrincipal,
    resourceName: string,
    id: string,
  ): Promise<ResourceView> {
    const descriptor = this.resolve(resourceName);
    const companyId = this.scopeCompanyId(descriptor, principal);
    const row = await this.repo.findById(descriptor, companyId, id);
    if (row === null) throw AppErrors.notFound(`${descriptor.name} not found.`);
    return row;
  }

  /** The active reference set for a resource, memoized for hot-path consumers. */
  async listActiveCached(
    principal: RequestPrincipal,
    resourceName: string,
  ): Promise<readonly ResourceView[]> {
    const descriptor = this.resolve(resourceName);
    const companyId = this.scopeCompanyId(descriptor, principal);
    const scope = this.scopeKey(descriptor, companyId);
    const cached = this.cache.get(descriptor.name, scope);
    if (cached !== null) return cached;
    const rows = await this.repo.listActive(descriptor, companyId);
    this.cache.set(descriptor.name, scope, rows);
    return rows;
  }

  /** Create a tenant row. Rejected for system (read-only) resources. */
  async create(
    principal: RequestPrincipal,
    resourceName: string,
    body: unknown,
  ): Promise<ResourceView> {
    const descriptor = this.resolveWritable(resourceName);
    const companyId = this.requireTenant(principal);
    const { data, errors } = validateCreate(descriptor, body);
    if (errors.length > 0) throw AppErrors.validation("Request validation failed", errors);

    let row: ResourceView;
    try {
      row = await this.repo.create(descriptor, { companyId, actorId: principal.userId }, data);
    } catch (error) {
      throw this.mapError(error);
    }
    await this.afterWrite(descriptor, companyId, principal.userId, row, "created");
    return row;
  }

  /** Update a tenant row (partial). Rejected for system resources; `404` if absent. */
  async update(
    principal: RequestPrincipal,
    resourceName: string,
    id: string,
    body: unknown,
  ): Promise<ResourceView> {
    const descriptor = this.resolveWritable(resourceName);
    const companyId = this.requireTenant(principal);
    const { data, errors } = validateUpdate(descriptor, body);
    if (errors.length > 0) throw AppErrors.validation("Request validation failed", errors);

    let row: ResourceView | null;
    try {
      row = await this.repo.update(descriptor, { companyId, actorId: principal.userId }, id, data);
    } catch (error) {
      throw this.mapError(error);
    }
    if (row === null) throw AppErrors.notFound(`${descriptor.name} not found.`);
    await this.afterWrite(descriptor, companyId, principal.userId, row, "updated");
    return row;
  }

  /** Soft-delete a tenant row (`active = false`). `404` if absent. */
  async deactivate(principal: RequestPrincipal, resourceName: string, id: string): Promise<void> {
    const descriptor = this.resolveWritable(resourceName);
    const companyId = this.requireTenant(principal);
    const row = await this.repo.deactivate(
      descriptor,
      { companyId, actorId: principal.userId },
      id,
    );
    if (row === null) throw AppErrors.notFound(`${descriptor.name} not found.`);
    await this.afterWrite(descriptor, companyId, principal.userId, row, "deactivated");
  }

  // ---- internals -----------------------------------------------------------

  /** Durable audit + cache invalidation + additive event, in that order. */
  private async afterWrite(
    descriptor: ResourceDescriptor,
    companyId: string,
    actorId: string,
    row: ResourceView,
    change: "created" | "updated" | "deactivated",
  ): Promise<void> {
    await this.audit.record({
      companyId,
      actorId,
      action: `master_data.${change}`,
      entityType: descriptor.name,
      entityId: row.id,
      changes: row,
    });
    this.cache.invalidate(descriptor.name, this.scopeKey(descriptor, companyId));
    await this.events.publish({
      type: "master_data.changed",
      companyId,
      actorId,
      occurredAt: this.clock.now(),
      payload: { resource: descriptor.name, id: row.id, change },
    });
  }

  private resolve(resourceName: string): ResourceDescriptor {
    const descriptor = findResource(resourceName);
    if (descriptor === undefined) throw AppErrors.notFound(`Unknown resource: ${resourceName}.`);
    return descriptor;
  }

  /** Resolve a resource and reject writes to system (read-only) reference data. */
  private resolveWritable(resourceName: string): ResourceDescriptor {
    const descriptor = this.resolve(resourceName);
    if (descriptor.scope === "system") {
      throw AppErrors.forbidden(`${descriptor.name} is system-managed and read-only.`);
    }
    return descriptor;
  }

  /** The companyId a read should scope to: null for system, the tenant otherwise. */
  private scopeCompanyId(
    descriptor: ResourceDescriptor,
    principal: RequestPrincipal,
  ): string | null {
    if (descriptor.scope === "system") return null;
    return this.requireTenant(principal);
  }

  private scopeKey(descriptor: ResourceDescriptor, companyId: string | null): string {
    return descriptor.scope === "system" ? "system" : (companyId ?? "system");
  }

  private requireTenant(principal: RequestPrincipal): string {
    if (principal.companyId === null) {
      throw AppErrors.forbidden("Select an active company first.");
    }
    return principal.companyId;
  }

  private mapError(error: unknown): unknown {
    if (error instanceof DuplicateResourceError) {
      return AppErrors.conflict(error.message);
    }
    if (error instanceof ReferenceNotFoundError) {
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
