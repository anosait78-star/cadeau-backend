import { Inject, Injectable } from "@nestjs/common";
import {
  buildKeysetPage,
  clampLimit,
  type CursorValues,
  decodeCursor,
  InvalidCursorError,
  type KeysetPage,
  Prisma,
  type PrismaClient,
  setTenantContext,
  stampForCreate,
  stampForUpdate,
} from "@cadeau/database";
import type { ParsedListQuery } from "../domain/list-query";
import type { MasterDataRepositoryPort, WriteActor } from "../domain/master-data-repository.port";
import {
  DuplicateResourceError,
  InvalidListCursorError,
  ReferenceNotFoundError,
} from "../domain/master-data.errors";
import type { ResourceDescriptor, ResourceView, SortField } from "../domain/resource.types";
import { MASTER_DATA_PRISMA_CLIENT } from "./prisma-client.provider";

/** The subset of a Prisma model delegate the generic engine uses. */
interface CrudDelegate {
  findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  findFirst(args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  create(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
}

/** A Prisma client or transaction client, indexable by model name. */
type DelegateHost = Record<string, CrudDelegate>;

/** A decoded keyset cursor: primary sort value + tie-breaker (id/code). */
interface DecodedCursor {
  readonly p: string;
  readonly t: string;
}

/**
 * The single, generic Prisma-backed repository behind every master-data
 * resource. It reads each {@link ResourceDescriptor} to build the `select`,
 * `where`, keyset predicate, and write payload — so it has no per-resource code.
 * System resources read without a tenant (their RLS SELECT is public); tenant
 * resources bind the company under RLS for the whole unit of work
 * (`setTenantContext`), the app-layer half of the two-layer isolation model.
 */
@Injectable()
export class MasterDataRepository implements MasterDataRepositoryPort {
  constructor(@Inject(MASTER_DATA_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async list(
    descriptor: ResourceDescriptor,
    companyId: string | null,
    query: ParsedListQuery,
  ): Promise<KeysetPage<ResourceView>> {
    const limit = clampLimit(query.limit);
    const cursor = this.decode(query, query.cursor);
    const where = this.buildWhere(descriptor, companyId, query, cursor);
    const orderBy = [
      { [query.sort.field]: query.sort.dir },
      { [descriptor.idField]: query.sort.dir },
    ];
    const rows = await this.read(descriptor, companyId, (host) =>
      this.delegate(host, descriptor.model).findMany({
        where,
        orderBy,
        take: limit + 1,
        select: this.select(descriptor),
      }),
    );
    const views = rows.map((r) => this.toView(descriptor, r));
    return buildKeysetPage(views, limit, (view) => this.toCursor(query, view));
  }

  async listActive(
    descriptor: ResourceDescriptor,
    companyId: string | null,
  ): Promise<ResourceView[]> {
    const sortField: SortField = "name";
    const where = this.buildWhere(
      descriptor,
      companyId,
      { sort: { field: sortField, dir: "asc" }, active: true, filters: {} },
      null,
    );
    const rows = await this.read(descriptor, companyId, (host) =>
      this.delegate(host, descriptor.model).findMany({
        where,
        orderBy: [{ name: "asc" }, { [descriptor.idField]: "asc" }],
        select: this.select(descriptor),
      }),
    );
    return rows.map((r) => this.toView(descriptor, r));
  }

  async findById(
    descriptor: ResourceDescriptor,
    companyId: string | null,
    id: string,
  ): Promise<ResourceView | null> {
    const where = this.scopedIdWhere(descriptor, companyId, id);
    const row = await this.read(descriptor, companyId, (host) =>
      this.delegate(host, descriptor.model).findFirst({ where, select: this.select(descriptor) }),
    );
    return row === null ? null : this.toView(descriptor, row);
  }

  async create(
    descriptor: ResourceDescriptor,
    actor: WriteActor,
    data: Record<string, unknown>,
  ): Promise<ResourceView> {
    return this.tenantTx(actor.companyId, async (host) => {
      await this.assertTenantRefs(descriptor, actor.companyId, host, data);
      try {
        const row = await this.delegate(host, descriptor.model).create({
          data: stampForCreate(actor, data),
          select: this.select(descriptor),
        });
        return this.toView(descriptor, row);
      } catch (error) {
        throw this.mapWriteError(error);
      }
    });
  }

  async update(
    descriptor: ResourceDescriptor,
    actor: WriteActor,
    id: string,
    data: Record<string, unknown>,
  ): Promise<ResourceView | null> {
    return this.tenantTx(actor.companyId, async (host) => {
      await this.assertTenantRefs(descriptor, actor.companyId, host, data);
      const delegate = this.delegate(host, descriptor.model);
      const where = this.scopedIdWhere(descriptor, actor.companyId, id);
      try {
        const { count } = await delegate.updateMany({ where, data: stampForUpdate(actor, data) });
        if (count === 0) return null;
      } catch (error) {
        throw this.mapWriteError(error);
      }
      const row = await delegate.findFirst({ where, select: this.select(descriptor) });
      return row === null ? null : this.toView(descriptor, row);
    });
  }

  async deactivate(
    descriptor: ResourceDescriptor,
    actor: WriteActor,
    id: string,
  ): Promise<ResourceView | null> {
    return this.tenantTx(actor.companyId, async (host) => {
      const delegate = this.delegate(host, descriptor.model);
      const where = this.scopedIdWhere(descriptor, actor.companyId, id);
      const { count } = await delegate.updateMany({
        where,
        data: stampForUpdate(actor, { isActive: false }),
      });
      if (count === 0) return null;
      const row = await delegate.findFirst({ where, select: this.select(descriptor) });
      return row === null ? null : this.toView(descriptor, row);
    });
  }

  // ---- internals -----------------------------------------------------------

  /** Resolve a model delegate on a client/transaction host. */
  private delegate(host: DelegateHost, model: string): CrudDelegate {
    return host[model] as CrudDelegate;
  }

  /** Run a read: tenant reads bind the RLS context; system reads use the client. */
  private read<T>(
    descriptor: ResourceDescriptor,
    companyId: string | null,
    fn: (host: DelegateHost) => Promise<T>,
  ): Promise<T> {
    if (descriptor.scope === "tenant") {
      if (companyId === null) throw new Error("tenant resource requires a companyId");
      return this.tenantTx(companyId, fn);
    }
    return fn(this.prisma as unknown as DelegateHost);
  }

  /** Run a unit of work with the tenant RLS context bound for its duration. */
  private tenantTx<T>(companyId: string, fn: (host: DelegateHost) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return fn(tx as unknown as DelegateHost);
    });
  }

  private select(descriptor: ResourceDescriptor): Record<string, boolean> {
    const select: Record<string, boolean> = {
      [descriptor.idField]: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    };
    for (const field of descriptor.fields) select[field.name] = true;
    return select;
  }

  private toView(descriptor: ResourceDescriptor, row: Record<string, unknown>): ResourceView {
    const view: Record<string, unknown> = {
      id: String(row[descriptor.idField]),
      active: Boolean(row["isActive"]),
      createdAt: (row["createdAt"] as Date).toISOString(),
      updatedAt: (row["updatedAt"] as Date).toISOString(),
    };
    for (const field of descriptor.fields) view[field.name] = row[field.name] ?? null;
    return view as ResourceView;
  }

  private buildWhere(
    descriptor: ResourceDescriptor,
    companyId: string | null,
    query: ParsedListQuery,
    cursor: DecodedCursor | null,
  ): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    if (descriptor.scope === "tenant" && companyId !== null) where["companyId"] = companyId;
    if (query.active !== "all") where["isActive"] = query.active;
    for (const [field, value] of Object.entries(query.filters)) where[field] = value;
    if (query.q !== undefined) {
      where["OR"] = descriptor.searchable.map((f) => ({
        [f]: { contains: query.q, mode: "insensitive" },
      }));
    }
    if (cursor !== null) {
      where["AND"] = [this.keysetPredicate(descriptor, query, cursor)];
    }
    return where;
  }

  private keysetPredicate(
    descriptor: ResourceDescriptor,
    query: ParsedListQuery,
    cursor: DecodedCursor,
  ): Record<string, unknown> {
    const primary = query.sort.field;
    const tie = descriptor.idField;
    const op = query.sort.dir === "asc" ? "gt" : "lt";
    const primaryValue: string | Date = primary === "createdAt" ? new Date(cursor.p) : cursor.p;
    return {
      OR: [
        { [primary]: { [op]: primaryValue } },
        { AND: [{ [primary]: primaryValue }, { [tie]: { [op]: cursor.t } }] },
      ],
    };
  }

  private toCursor(query: ParsedListQuery, view: ResourceView): CursorValues {
    const p = query.sort.field === "createdAt" ? view.createdAt : String(view[query.sort.field]);
    return { p, t: view.id };
  }

  private decode(query: ParsedListQuery, raw: string | undefined): DecodedCursor | null {
    if (raw === undefined) return null;
    try {
      const decoded = decodeCursor(raw);
      const p = decoded["p"];
      const t = decoded["t"];
      if (typeof p !== "string" || typeof t !== "string") throw new InvalidListCursorError();
      if (query.sort.field === "createdAt" && Number.isNaN(Date.parse(p))) {
        throw new InvalidListCursorError();
      }
      return { p, t };
    } catch (error) {
      if (error instanceof InvalidCursorError) throw new InvalidListCursorError();
      throw error;
    }
  }

  private scopedIdWhere(
    descriptor: ResourceDescriptor,
    companyId: string | null,
    id: string,
  ): Record<string, unknown> {
    const where: Record<string, unknown> = { [descriptor.idField]: id };
    if (descriptor.scope === "tenant" && companyId !== null) where["companyId"] = companyId;
    return where;
  }

  /**
   * For every provided field that references a row in the same tenant (e.g. a
   * category's parent), confirm the target exists AND belongs to this company —
   * explicit `companyId` filtering, not just RLS (some tables here only enforce
   * RLS on writes, not reads). Missing → a domain error the service renders as `422`.
   */
  private async assertTenantRefs(
    descriptor: ResourceDescriptor,
    companyId: string,
    host: DelegateHost,
    data: Record<string, unknown>,
  ): Promise<void> {
    for (const field of descriptor.fields) {
      if (field.tenantRefModel === undefined) continue;
      const value = data[field.name];
      if (value === undefined || value === null) continue;
      const found = await this.delegate(host, field.tenantRefModel).findFirst({
        where: { id: value, companyId },
        select: { id: true },
      });
      if (found === null) throw new ReferenceNotFoundError(field.name);
    }
  }

  private mapWriteError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return new DuplicateResourceError();
    }
    return error;
  }
}
