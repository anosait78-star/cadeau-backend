import { Inject, Injectable, Logger } from "@nestjs/common";
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
import { blindIndex, decrypt, encrypt, EncryptionError } from "@cadeau/crypto";
import { APP_CONFIG, type InjectedAppConfig } from "../../../shared/config/config.tokens";
import type {
  CustomerAddressView,
  CustomerListView,
  CustomerMergeResult,
  CustomerOrderSummaryView,
  CustomerView,
  CustomerWithAddresses,
  CustomerWriteResult,
} from "../domain/customer.entity";
import type {
  CreateAddressInput,
  CreateCustomerInput,
  CustomersRepositoryPort,
  UpdateAddressInput,
  UpdateCustomerInput,
  WriteActor,
} from "../domain/customers-repository.port";
import {
  DuplicateCustomerError,
  InvalidListCursorError,
  InvalidMergeError,
  ReferenceNotFoundError,
} from "../domain/customers.errors";
import type { ParsedCustomerListQuery } from "../domain/list-query";
import { maskPhone } from "../domain/phone";
import { CUSTOMERS_PRISMA_CLIENT } from "./prisma-client.provider";

/** A Prisma client or transaction client. */
type Tx = Prisma.TransactionClient;

/** A decoded keyset cursor: primary sort value + id tie-breaker. */
interface DecodedCursor {
  readonly p: string;
  readonly t: string;
}

/**
 * The hard ceiling on one export. Bulk PII egress is gated and audited, but it
 * is also *bounded*: no single request can walk the whole customer base.
 */
export const EXPORT_MAX_ROWS = 5_000;

/**
 * Every table a customer owns, that a merge must re-parent from the merged
 * customer to the survivor (decision D5). This is the ONE authoritative list; the
 * merge below re-parents exactly these, and `customers.repository.merge.test.ts`
 * fails loudly if a new model gains a `customerId` foreign key without being
 * added here — so a future customer-owned table can never silently escape merge.
 */
export const CUSTOMER_OWNED_TABLES = ["customer_addresses", "orders", "order_reviews"] as const;

const CUSTOMER_SELECT = {
  id: true,
  name: true,
  phoneEncrypted: true,
  email: true,
  notes: true,
  ordersCount: true,
  totalSpent: true,
  lastOrderAt: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ADDRESS_SELECT = {
  id: true,
  customerId: true,
  lineEncrypted: true,
  landmark: true,
  notes: true,
  governorateId: true,
  bostaCityId: true,
  bostaDistrictId: true,
  bostaCityName: true,
  isDefault: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

type CustomerRow = {
  id: string;
  name: string;
  phoneEncrypted: string;
  email: string | null;
  notes: string | null;
  ordersCount: number;
  totalSpent: bigint;
  lastOrderAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type AddressRow = {
  id: string;
  customerId: string;
  lineEncrypted: string;
  landmark: string | null;
  notes: string | null;
  governorateId: string | null;
  bostaCityId: string | null;
  bostaDistrictId: string | null;
  bostaCityName: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Prisma-backed customers repository (EPIC-10).
 *
 * Two responsibilities beyond the usual CRUD:
 *
 * 1. **Tenant isolation.** Every unit of work binds the tenant under RLS
 *    (`setTenantContext`) — the app-layer half of the two-layer model — so the
 *    WHERE clause and Postgres RLS must agree before a row is visible.
 * 2. **The PII round-trip.** Plaintext comes in, the stored pair goes out:
 *    `phone_encrypted` (AES-256-GCM, the source of truth) and `phone_hash`
 *    (HMAC blind index, which carries the uniqueness rule and answers exact
 *    lookups). Nothing above this class ever sees a hash, and no plaintext phone
 *    column exists to leak. See `docs/privacy-model.md`.
 *
 * Callers must hand in an **already-normalized** E.164 phone; the domain owns
 * that step, and hashing an un-normalized value would quietly defeat the unique
 * index.
 */
/** Shown in place of a phone/address that failed decryption (stale key). */
const UNREADABLE_PLACEHOLDER = "[تعذّر فك التشفير]";

@Injectable()
export class CustomersRepository implements CustomersRepositoryPort {
  private readonly logger = new Logger(CustomersRepository.name);

  constructor(
    @Inject(CUSTOMERS_PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: InjectedAppConfig,
  ) {}

  async list(
    companyId: string,
    query: ParsedCustomerListQuery,
  ): Promise<KeysetPage<CustomerListView>> {
    const limit = clampLimit(query.limit);
    const cursor = this.decode(query, query.cursor);
    const where = this.buildWhere(companyId, query, cursor);
    const orderBy = [{ [query.sort.field]: query.sort.dir }, { id: query.sort.dir }];
    const rows = await this.tenantTx(companyId, (tx) =>
      tx.customer.findMany({ where, orderBy, take: limit + 1, select: CUSTOMER_SELECT }),
    );
    const views = rows.map((r) => this.toListView(r));
    return buildKeysetPage(views, limit, (view) => this.toCursor(query, view));
  }

  async exportAll(
    companyId: string,
    query: ParsedCustomerListQuery,
  ): Promise<readonly CustomerView[]> {
    const take = Math.min(query.limit ?? EXPORT_MAX_ROWS, EXPORT_MAX_ROWS);
    const where = this.buildWhere(companyId, query, null);
    const rows = await this.tenantTx(companyId, (tx) =>
      tx.customer.findMany({
        where,
        orderBy: [{ [query.sort.field]: query.sort.dir }, { id: query.sort.dir }],
        take,
        select: CUSTOMER_SELECT,
      }),
    );
    return rows.map((r) => this.toDetailView(r));
  }

  async findById(companyId: string, id: string): Promise<CustomerWithAddresses | null> {
    return this.tenantTx(companyId, async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id, companyId },
        select: CUSTOMER_SELECT,
      });
      if (customer === null) return null;
      const addresses = await tx.customerAddress.findMany({
        where: { customerId: id, companyId },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        select: ADDRESS_SELECT,
      });
      return {
        ...this.toDetailView(customer),
        addresses: addresses.map((a) => this.toAddressView(a)),
      };
    });
  }

  async create(actor: WriteActor, data: CreateCustomerInput): Promise<CustomerWriteResult> {
    return this.tenantTx(actor.companyId, async (tx) => {
      // Sequential retry: the key was already used, so replay and write nothing.
      const replay = await this.findByIdempotencyKey(tx, actor.companyId, data.idempotencyKey);
      if (replay !== null) return { customer: this.toDetailView(replay), replayed: true };

      try {
        const row = await tx.customer.create({
          data: stampForCreate(actor, {
            name: data.name,
            phoneEncrypted: this.encryptPhone(data.phone),
            phoneHash: this.hashPhone(data.phone),
            email: data.email ?? null,
            notes: data.notes ?? null,
            idempotencyKey: data.idempotencyKey ?? null,
          }) as Prisma.CustomerUncheckedCreateInput,
          select: CUSTOMER_SELECT,
        });
        return { customer: this.toDetailView(row), replayed: false };
      } catch (error) {
        // Concurrent retry: two requests carried the same key, one won the
        // unique index. The loser replays the winner's row instead of failing —
        // otherwise a client retry could surface a spurious 409.
        const raced = await this.replayOnKeyConflict(
          tx,
          actor.companyId,
          data.idempotencyKey,
          error,
        );
        if (raced !== null) return { customer: this.toDetailView(raced), replayed: true };
        throw this.mapWriteError(error);
      }
    });
  }

  async update(
    actor: WriteActor,
    id: string,
    data: UpdateCustomerInput,
  ): Promise<CustomerView | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const where = { id, companyId: actor.companyId };
      const patch: Record<string, unknown> = {};
      if (data.name !== undefined) patch["name"] = data.name;
      if (data.email !== undefined) patch["email"] = data.email;
      if (data.notes !== undefined) patch["notes"] = data.notes;
      // Both stored columns are re-derived together: a ciphertext that no longer
      // matches its blind index would make the customer unfindable.
      if (data.phone !== undefined) {
        patch["phoneEncrypted"] = this.encryptPhone(data.phone);
        patch["phoneHash"] = this.hashPhone(data.phone);
      }
      try {
        const { count } = await tx.customer.updateMany({
          where,
          data: stampForUpdate(actor, patch) as Prisma.CustomerUncheckedUpdateManyInput,
        });
        if (count === 0) return null;
      } catch (error) {
        throw this.mapWriteError(error);
      }
      const row = await tx.customer.findFirst({ where, select: CUSTOMER_SELECT });
      return row === null ? null : this.toDetailView(row);
    });
  }

  async archive(actor: WriteActor, id: string): Promise<CustomerView | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const where = { id, companyId: actor.companyId };
      const { count } = await tx.customer.updateMany({
        where,
        data: stampForUpdate(actor, { isActive: false }) as Prisma.CustomerUncheckedUpdateManyInput,
      });
      if (count === 0) return null;
      const row = await tx.customer.findFirst({ where, select: CUSTOMER_SELECT });
      return row === null ? null : this.toDetailView(row);
    });
  }

  async listAddresses(
    companyId: string,
    customerId: string,
  ): Promise<readonly CustomerAddressView[] | null> {
    return this.tenantTx(companyId, async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, companyId },
        select: { id: true },
      });
      if (customer === null) return null;
      const rows = await tx.customerAddress.findMany({
        where: { customerId, companyId },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        select: ADDRESS_SELECT,
      });
      return rows.map((a) => this.toAddressView(a));
    });
  }

  async createAddress(
    actor: WriteActor,
    customerId: string,
    data: CreateAddressInput,
  ): Promise<CustomerAddressView | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, companyId: actor.companyId },
        select: { id: true },
      });
      if (customer === null) return null;
      await this.assertGovernorate(tx, data.governorateId);
      if (data.isDefault === true) await this.demoteDefault(tx, actor, customerId, null);
      const row = await tx.customerAddress.create({
        data: stampForCreate(actor, {
          customerId,
          lineEncrypted: this.encryptLine(data.line),
          landmark: data.landmark ?? null,
          notes: data.notes ?? null,
          governorateId: data.governorateId ?? null,
          bostaCityId: data.bostaCityId ?? null,
          bostaDistrictId: data.bostaDistrictId ?? null,
          bostaCityName: data.bostaCityName ?? null,
          isDefault: data.isDefault ?? false,
        }) as Prisma.CustomerAddressUncheckedCreateInput,
        select: ADDRESS_SELECT,
      });
      return this.toAddressView(row);
    });
  }

  async updateAddress(
    actor: WriteActor,
    customerId: string,
    addressId: string,
    data: UpdateAddressInput,
  ): Promise<CustomerAddressView | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const where = { id: addressId, customerId, companyId: actor.companyId };
      await this.assertGovernorate(tx, data.governorateId);
      // "One default per customer" is a partial unique index, so the incumbent
      // must step down inside this same transaction or the write trips it.
      if (data.isDefault === true) await this.demoteDefault(tx, actor, customerId, addressId);

      const patch: Record<string, unknown> = {};
      if (data.line !== undefined) patch["lineEncrypted"] = this.encryptLine(data.line);
      if (data.landmark !== undefined) patch["landmark"] = data.landmark;
      if (data.notes !== undefined) patch["notes"] = data.notes;
      if (data.governorateId !== undefined) patch["governorateId"] = data.governorateId;
      if (data.bostaCityId !== undefined) patch["bostaCityId"] = data.bostaCityId;
      if (data.bostaDistrictId !== undefined) patch["bostaDistrictId"] = data.bostaDistrictId;
      if (data.bostaCityName !== undefined) patch["bostaCityName"] = data.bostaCityName;
      if (data.isDefault !== undefined) patch["isDefault"] = data.isDefault;
      if (data.active !== undefined) patch["isActive"] = data.active;

      const { count } = await tx.customerAddress.updateMany({
        where,
        data: stampForUpdate(actor, patch) as Prisma.CustomerAddressUncheckedUpdateManyInput,
      });
      if (count === 0) return null;
      const row = await tx.customerAddress.findFirst({ where, select: ADDRESS_SELECT });
      return row === null ? null : this.toAddressView(row);
    });
  }

  async listCustomerOrders(
    companyId: string,
    customerId: string,
    limit: number | undefined,
    cursor: string | undefined,
  ): Promise<KeysetPage<CustomerOrderSummaryView> | null> {
    return this.tenantTx(companyId, async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, companyId },
        select: { id: true },
      });
      if (customer === null) return null;
      const take = clampLimit(limit);
      const decoded = this.decodeOrderCursor(cursor);
      const where: Prisma.OrderWhereInput = { customerId, companyId };
      if (decoded !== null) {
        where.OR = [
          { createdAt: { lt: new Date(decoded.p) } },
          { AND: [{ createdAt: new Date(decoded.p) }, { id: { lt: decoded.t } }] },
        ];
      }
      const rows = await tx.order.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: take + 1,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          total: true,
          collectedAmount: true,
          createdAt: true,
          // Order.review is a plain Prisma relation on the shared schema — no
          // import from the `reviews` module (no-cross-feature-imports).
          review: {
            select: {
              id: true,
              productType: true,
              qualityRating: true,
              packagingRating: true,
              shippingRating: true,
              createdAt: true,
            },
          },
        },
      });
      const views: CustomerOrderSummaryView[] = rows.map((r) => ({
        id: r.id,
        orderNumber: Number(r.orderNumber),
        status: r.status,
        total: Number(r.total),
        collectedAmount: Number(r.collectedAmount),
        createdAt: r.createdAt.toISOString(),
        review:
          r.review === null
            ? null
            : {
                id: r.review.id,
                productType: r.review.productType,
                qualityRating: r.review.qualityRating,
                packagingRating: r.review.packagingRating,
                shippingRating: r.review.shippingRating,
                averageRating:
                  Math.round(
                    ((r.review.qualityRating + r.review.packagingRating + r.review.shippingRating) /
                      3) *
                      10,
                  ) / 10,
                createdAt: r.review.createdAt.toISOString(),
              },
      }));
      return buildKeysetPage(views, take, (v) => ({ p: v.createdAt, t: v.id }));
    });
  }

  async merge(
    actor: WriteActor,
    survivingCustomerId: string,
    mergedCustomerId: string,
  ): Promise<CustomerMergeResult | null> {
    if (survivingCustomerId === mergedCustomerId) throw new InvalidMergeError();
    return this.tenantTx(actor.companyId, async (tx) => {
      const where = { companyId: actor.companyId };
      const survivor = await tx.customer.findFirst({
        where: { id: survivingCustomerId, ...where },
        select: { id: true },
      });
      const merged = await tx.customer.findFirst({
        where: { id: mergedCustomerId, ...where },
        select: { id: true },
      });
      if (survivor === null || merged === null) return null;

      // Re-parent EVERY customer-owned table (CUSTOMER_OWNED_TABLES). The merged
      // customer's addresses lose their default flag so the survivor keeps at
      // most one (the partial unique index).
      await tx.customerAddress.updateMany({
        where: { customerId: mergedCustomerId, ...where },
        data: stampForUpdate(actor, {
          customerId: survivingCustomerId,
          isDefault: false,
        }) as Prisma.CustomerAddressUncheckedUpdateManyInput,
      });
      await tx.order.updateMany({
        where: { customerId: mergedCustomerId, ...where },
        data: stampForUpdate(actor, {
          customerId: survivingCustomerId,
        }) as Prisma.OrderUncheckedUpdateManyInput,
      });
      // order_reviews.customerId is denormalized from order.customerId (Order
      // Reviews feature) — re-parent it alongside the orders it belongs to, or
      // a merged customer's reviews would silently orphan from their survivor.
      // No stampForUpdate: the table has no updatedBy/updatedAt (create-only).
      await tx.orderReview.updateMany({
        where: { customerId: mergedCustomerId, ...where },
        data: { customerId: survivingCustomerId },
      });

      // Archive the merged customer (never delete) and recompute the survivor's
      // KPIs from its now-combined order set.
      await tx.customer.updateMany({
        where: { id: mergedCustomerId, ...where },
        data: stampForUpdate(actor, { isActive: false }) as Prisma.CustomerUncheckedUpdateManyInput,
      });
      await this.recomputeKpis(tx, actor.companyId, survivingCustomerId);
      return { survivingCustomerId, mergedCustomerId };
    });
  }

  // ---- internals -----------------------------------------------------------

  /**
   * Recompute a customer's KPIs from its own orders (EPIC-11, decision D3): the
   * same aggregate the orders module runs on every order write, run here after a
   * merge folds another customer's orders in.
   */
  private async recomputeKpis(tx: Tx, companyId: string, customerId: string): Promise<void> {
    const stats = await tx.order.aggregate({
      where: { companyId, customerId, status: { not: "cancelled" } },
      _count: { _all: true },
      _sum: { collectedAmount: true },
      _max: { createdAt: true },
    });
    await tx.customer.updateMany({
      where: { id: customerId, companyId },
      data: {
        ordersCount: stats._count._all,
        totalSpent: stats._sum.collectedAmount ?? 0n,
        lastOrderAt: stats._max.createdAt ?? null,
      } as Prisma.CustomerUncheckedUpdateManyInput,
    });
  }

  /** Decode the `createdAt`+id cursor used by the customer order-history list. */
  private decodeOrderCursor(raw: string | undefined): DecodedCursor | null {
    if (raw === undefined) return null;
    try {
      const decoded = decodeCursor(raw);
      const p = decoded["p"];
      const t = decoded["t"];
      if (typeof p !== "string" || typeof t !== "string") throw new InvalidListCursorError();
      if (Number.isNaN(Date.parse(p))) throw new InvalidListCursorError();
      return { p, t };
    } catch (error) {
      if (error instanceof InvalidCursorError) throw new InvalidListCursorError();
      throw error;
    }
  }

  /** Run a unit of work with the tenant RLS context bound for its duration. */
  private tenantTx<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return fn(tx);
    });
  }

  private encryptPhone(e164: string): string {
    return encrypt(e164, this.config.encryption.key);
  }

  private hashPhone(e164: string): string {
    return blindIndex(e164, this.config.encryption.blindIndexKey);
  }

  private encryptLine(line: string): string {
    return encrypt(line, this.config.encryption.key);
  }

  /**
   * Decrypt a phone for display. Rows written before a key rotation can no
   * longer be decrypted with the current key — that must not crash the whole
   * list/detail response for every other customer, so a decrypt failure here
   * is logged and degrades to a visible placeholder instead of throwing.
   */
  private decryptPhone(token: string, context: string): string {
    try {
      return decrypt(token, this.config.encryption.key);
    } catch (error) {
      if (error instanceof EncryptionError) {
        this.logger.warn(`Could not decrypt ${context}: ${error.message}`);
        return UNREADABLE_PLACEHOLDER;
      }
      throw error;
    }
  }

  /** Decrypt an address line for display; see {@link decryptPhone}. */
  private decryptLine(token: string, context: string): string {
    try {
      return decrypt(token, this.config.encryption.key);
    } catch (error) {
      if (error instanceof EncryptionError) {
        this.logger.warn(`Could not decrypt ${context}: ${error.message}`);
        return UNREADABLE_PLACEHOLDER;
      }
      throw error;
    }
  }

  /** Look up a prior create by its idempotency key, if one was supplied. */
  private async findByIdempotencyKey(
    tx: Tx,
    companyId: string,
    key: string | null | undefined,
  ): Promise<CustomerRow | null> {
    if (key === null || key === undefined) return null;
    return tx.customer.findFirst({
      where: { companyId, idempotencyKey: key },
      select: CUSTOMER_SELECT,
    });
  }

  /**
   * Resolve the concurrent-retry race: if the failure was the idempotency unique
   * index tripping, the other request already stored the result — return it.
   * Any other failure (a duplicate phone, say) is not ours to swallow.
   */
  private async replayOnKeyConflict(
    tx: Tx,
    companyId: string,
    key: string | null | undefined,
    error: unknown,
  ): Promise<CustomerRow | null> {
    if (key === null || key === undefined) return null;
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      return null;
    }
    if (!String(error.meta?.["target"] ?? "").includes("idempotency")) return null;
    return this.findByIdempotencyKey(tx, companyId, key);
  }

  /** Step the current default address down so the partial unique index holds. */
  private async demoteDefault(
    tx: Tx,
    actor: WriteActor,
    customerId: string,
    exceptAddressId: string | null,
  ): Promise<void> {
    await tx.customerAddress.updateMany({
      where: {
        customerId,
        companyId: actor.companyId,
        isDefault: true,
        ...(exceptAddressId === null ? {} : { NOT: { id: exceptAddressId } }),
      },
      data: stampForUpdate(actor, {
        isDefault: false,
      }) as Prisma.CustomerAddressUncheckedUpdateManyInput,
    });
  }

  /**
   * Confirm a governorate reference exists. Governorates are system reference
   * data (not tenant-scoped), so this is an existence check, not an isolation
   * check. Missing → a domain error the service renders as `422`.
   */
  private async assertGovernorate(tx: Tx, governorateId: string | null | undefined): Promise<void> {
    if (governorateId === null || governorateId === undefined) return;
    const found = await tx.governorate.findFirst({
      where: { id: governorateId },
      select: { id: true },
    });
    if (found === null) throw new ReferenceNotFoundError("governorateId");
  }

  private toListView(row: CustomerRow): CustomerListView {
    // Masking still requires decrypting the row; what it limits is what the
    // *response* carries, not what the server reads.
    const phone = this.decryptPhone(row.phoneEncrypted, `customer ${row.id} phone`);
    return {
      id: row.id,
      name: row.name,
      phoneMasked: phone === UNREADABLE_PLACEHOLDER ? phone : maskPhone(phone),
      email: row.email,
      ordersCount: row.ordersCount,
      totalSpent: Number(row.totalSpent),
      lastOrderAt: row.lastOrderAt === null ? null : row.lastOrderAt.toISOString(),
      active: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetailView(row: CustomerRow): CustomerView {
    return {
      id: row.id,
      name: row.name,
      phone: this.decryptPhone(row.phoneEncrypted, `customer ${row.id} phone`),
      email: row.email,
      notes: row.notes,
      ordersCount: row.ordersCount,
      totalSpent: Number(row.totalSpent),
      lastOrderAt: row.lastOrderAt === null ? null : row.lastOrderAt.toISOString(),
      active: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toAddressView(row: AddressRow): CustomerAddressView {
    return {
      id: row.id,
      customerId: row.customerId,
      line: this.decryptLine(row.lineEncrypted, `address ${row.id} line`),
      landmark: row.landmark,
      notes: row.notes,
      governorateId: row.governorateId,
      bostaCityId: row.bostaCityId,
      bostaDistrictId: row.bostaDistrictId,
      bostaCityName: row.bostaCityName,
      isDefault: row.isDefault,
      active: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private buildWhere(
    companyId: string,
    query: ParsedCustomerListQuery,
    cursor: DecodedCursor | null,
  ): Prisma.CustomerWhereInput {
    const where: Prisma.CustomerWhereInput = { companyId };
    if (query.active !== "all") where.isActive = query.active;
    if (query.governorateId !== undefined) {
      where.addresses = { some: { governorateId: query.governorateId } };
    }
    if (query.hasOrders !== undefined) {
      // KPI is now maintained by EPIC-11, so "has orders" is a column predicate.
      where.ordersCount = query.hasOrders ? { gt: 0 } : 0;
    }
    if (query.createdAtFrom !== undefined || query.createdAtTo !== undefined) {
      where.createdAt = {
        ...(query.createdAtFrom !== undefined ? { gte: new Date(query.createdAtFrom) } : {}),
        ...(query.createdAtTo !== undefined ? { lte: new Date(query.createdAtTo) } : {}),
      };
    }
    if (query.search !== undefined) {
      if (query.search.kind === "phone") {
        // Exact match on the blind index — the only phone query a blind index
        // can answer. `contains` over a hash would be meaningless.
        where.phoneHash = this.hashPhone(query.search.e164);
      } else {
        where.OR = [
          { name: { contains: query.search.term, mode: "insensitive" } },
          { email: { contains: query.search.term, mode: "insensitive" } },
        ];
      }
    }
    if (cursor !== null) {
      where.AND = [this.keysetPredicate(query, cursor)];
    }
    return where;
  }

  private keysetPredicate(
    query: ParsedCustomerListQuery,
    cursor: DecodedCursor,
  ): Prisma.CustomerWhereInput {
    const primary = query.sort.field;
    const op = query.sort.dir === "asc" ? "gt" : "lt";
    const primaryValue: string | Date | number =
      primary === "createdAt"
        ? new Date(cursor.p)
        : primary === "ordersCount" || primary === "totalSpent"
          ? Number(cursor.p)
          : cursor.p;
    return {
      OR: [
        { [primary]: { [op]: primaryValue } },
        { AND: [{ [primary]: primaryValue }, { id: { [op]: cursor.t } }] },
      ],
    } as Prisma.CustomerWhereInput;
  }

  /**
   * Cursors carry sort keys only — `createdAt`/`name` and the id. A cursor is
   * opaque but not secret, so a personal field must never end up in one
   * (docs/privacy-model.md §6).
   */
  private toCursor(query: ParsedCustomerListQuery, view: CustomerListView): CursorValues {
    const p =
      query.sort.field === "createdAt"
        ? view.createdAt
        : query.sort.field === "name"
          ? view.name
          : query.sort.field === "ordersCount"
            ? String(view.ordersCount)
            : String(view.totalSpent);
    return { p, t: view.id };
  }

  private decode(query: ParsedCustomerListQuery, raw: string | undefined): DecodedCursor | null {
    if (raw === undefined) return null;
    try {
      const decoded = decodeCursor(raw);
      const p = decoded["p"];
      const t = decoded["t"];
      if (typeof p !== "string" || typeof t !== "string") throw new InvalidListCursorError();
      if (query.sort.field === "createdAt" && Number.isNaN(Date.parse(p))) {
        throw new InvalidListCursorError();
      }
      if (
        (query.sort.field === "ordersCount" || query.sort.field === "totalSpent") &&
        Number.isNaN(Number(p))
      ) {
        throw new InvalidListCursorError();
      }
      return { p, t };
    } catch (error) {
      if (error instanceof InvalidCursorError) throw new InvalidListCursorError();
      throw error;
    }
  }

  /** Map a Prisma unique-violation to the right duplicate-field domain error. */
  private mapWriteError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.["target"] ?? "");
      if (target.includes("idempotency")) return new DuplicateCustomerError("idempotencyKey");
      // The only other unique index on this table is (company_id, phone_hash).
      return new DuplicateCustomerError("phone");
    }
    return error;
  }
}
