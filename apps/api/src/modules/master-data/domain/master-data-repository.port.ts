import type { KeysetPage } from "@cadeau/database";
import type { ParsedListQuery } from "./list-query";
import type { ResourceDescriptor, ResourceView } from "./resource.types";

/** The tenant + acting member for a write (tenant resources only). */
export interface WriteActor {
  readonly companyId: string;
  readonly actorId: string;
}

/**
 * Port for reading/writing master-data resources. One generic implementation
 * (the Prisma adapter) serves every descriptor: system resources read without a
 * tenant; tenant resources bind the company under RLS. `companyId` is `null` for
 * system resources.
 *
 * Uniqueness violations surface as {@link DuplicateResourceError}; a bad tenant
 * reference as {@link ReferenceNotFoundError}; a bad cursor as
 * {@link InvalidListCursorError}. Not-found reads/writes return `null`.
 */
export interface MasterDataRepositoryPort {
  list(
    descriptor: ResourceDescriptor,
    companyId: string | null,
    query: ParsedListQuery,
  ): Promise<KeysetPage<ResourceView>>;

  findById(
    descriptor: ResourceDescriptor,
    companyId: string | null,
    id: string,
  ): Promise<ResourceView | null>;

  /** Every active row for a resource (used to warm the reference cache). */
  listActive(descriptor: ResourceDescriptor, companyId: string | null): Promise<ResourceView[]>;

  create(
    descriptor: ResourceDescriptor,
    actor: WriteActor,
    data: Record<string, unknown>,
  ): Promise<ResourceView>;

  update(
    descriptor: ResourceDescriptor,
    actor: WriteActor,
    id: string,
    data: Record<string, unknown>,
  ): Promise<ResourceView | null>;

  /** Soft-delete: set `is_active = false`. Returns the row, or `null` if absent. */
  deactivate(
    descriptor: ResourceDescriptor,
    actor: WriteActor,
    id: string,
  ): Promise<ResourceView | null>;
}

/** DI token for {@link MasterDataRepositoryPort}. */
export const MASTER_DATA_REPOSITORY = Symbol("MASTER_DATA_REPOSITORY");
