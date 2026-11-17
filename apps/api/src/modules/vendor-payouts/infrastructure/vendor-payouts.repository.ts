import { Inject, Injectable } from "@nestjs/common";
import {
  buildKeysetPage,
  clampLimit,
  decodeCursor,
  InvalidCursorError,
  Prisma,
  setTenantContext,
  setUserContext,
  type KeysetPage,
  type PrismaClient,
} from "@cadeau/database";
import {
  ledgerEntryStateOf,
  type LedgerEntryKind,
  type LedgerEntryView,
  type PayoutConfirmationKind,
  type PayoutMethod,
  type PayoutStatus,
  type PayoutView,
  type VendorBalanceView,
} from "../domain/vendor-payout.entity";
import type {
  ConfirmPayoutInput,
  CreateAdjustmentInput,
  CreatePayoutInput,
  MemberScope,
  PageQuery,
  VendorPayoutsRepositoryPort,
  WriteActor,
} from "../domain/vendor-payouts-repository.port";
import {
  IdempotencyKeyReusedError,
  NothingToPayError,
  PayoutAlreadyPendingError,
  PayoutNotFoundError,
  PayoutNotPendingError,
  PayoutPeriodClosedError,
  VendorNotFoundError,
} from "../domain/vendor-payouts.errors";
import { VENDOR_PAYOUTS_PRISMA_CLIENT } from "./prisma-client.provider";

type Tx = Prisma.TransactionClient;

/**
 * A warehouse is a vendor's when a storefront vendor is mapped to it or a
 * vendor account was ever scoped to it — the same rule the orders module uses
 * when it accrues at delivery, so every warehouse that can be owed is listed.
 */
const VENDOR_WAREHOUSE = {
  OR: [{ vendorMappings: { some: {} } }, { vendorMembers: { some: {} } }],
} satisfies Prisma.WarehouseWhereInput;

const PAYOUT_SELECT = {
  id: true,
  warehouseId: true,
  amountMinor: true,
  method: true,
  reference: true,
  notes: true,
  status: true,
  confirmationKind: true,
  forceReason: true,
  confirmedAt: true,
  cancelledAt: true,
  createdAt: true,
  warehouse: { select: { name: true } },
  _count: { select: { entries: true } },
} as const;

type PayoutRow = Prisma.VendorPayoutGetPayload<{ select: typeof PAYOUT_SELECT }>;

const ENTRY_SELECT = {
  id: true,
  kind: true,
  orderId: true,
  variantId: true,
  nameSnapshot: true,
  quantity: true,
  unitCostMinor: true,
  amountMinor: true,
  needsPricing: true,
  payoutId: true,
  note: true,
  createdAt: true,
  order: { select: { orderNumber: true } },
  payout: { select: { status: true } },
} as const;

type EntryRow = Prisma.VendorLedgerEntryGetPayload<{ select: typeof ENTRY_SELECT }>;

/** Raised inside the payout transaction when the idempotency key raced; replayed outside it. */
class IdempotencyRaceSignal extends Error {}

/**
 * Prisma-backed vendor ledger + payouts. Every unit of work binds BOTH the
 * tenant and the acting user, so `app.current_member_warehouse_id()` resolves
 * and the warehouse-scoped RLS policies on both tables confine a vendor to
 * their own rows at the database — in addition to the service's checks.
 */
@Injectable()
export class VendorPayoutsRepository implements VendorPayoutsRepositoryPort {
  constructor(@Inject(VENDOR_PAYOUTS_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findMemberScope(companyId: string, userId: string): Promise<MemberScope | null> {
    const row = await this.tx(companyId, userId, (tx) =>
      tx.companyMember.findFirst({
        where: { companyId, userId, status: "active" },
        select: { warehouseId: true },
      }),
    );
    return row === null ? null : { warehouseId: row.warehouseId };
  }

  async listVendorBalances(
    companyId: string,
    userId: string,
  ): Promise<readonly VendorBalanceView[]> {
    const balances = await this.tx(companyId, userId, (tx) => this.balances(tx, companyId, null));
    return this.withVendorNames(companyId, balances);
  }

  async getVendorBalance(
    companyId: string,
    userId: string,
    warehouseId: string,
  ): Promise<VendorBalanceView | null> {
    const balances = await this.tx(companyId, userId, (tx) =>
      this.balances(tx, companyId, warehouseId),
    );
    const [balance] = await this.withVendorNames(companyId, balances);
    return balance ?? null;
  }

  /**
   * The display name of each warehouse's (first active) vendor account.
   *
   * Read in a tenant-only transaction on purpose: with the user bound, the
   * `profiles` RLS policy hides every profile but the caller's own, so the
   * join returns `null` for a required relation and Prisma throws (the first
   * production deploy did exactly that). The warehouses passed in were already
   * read under the user-bound transaction, so this only adds names to rows the
   * caller is allowed to see — the same tenant-scoped profile read the orders
   * module uses for vendor groups.
   */
  private async withVendorNames(
    companyId: string,
    balances: readonly VendorBalanceView[],
  ): Promise<VendorBalanceView[]> {
    if (balances.length === 0) return [];
    const members = await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return tx.companyMember.findMany({
        where: {
          companyId,
          status: "active",
          warehouseId: { in: balances.map((b) => b.warehouseId) },
        },
        orderBy: { createdAt: "asc" },
        select: { warehouseId: true, user: { select: { fullName: true, email: true } } },
      });
    });
    const nameBy = new Map<string, string>();
    for (const member of members) {
      if (member.warehouseId === null || nameBy.has(member.warehouseId)) continue;
      nameBy.set(member.warehouseId, member.user.fullName ?? member.user.email);
    }
    return balances.map((b) => ({ ...b, vendorName: nameBy.get(b.warehouseId) ?? null }));
  }

  async listLedger(
    companyId: string,
    userId: string,
    warehouseId: string,
    query: PageQuery,
  ): Promise<KeysetPage<LedgerEntryView>> {
    const take = clampLimit(query.limit);
    const where: Prisma.VendorLedgerEntryWhereInput = { companyId, warehouseId };
    this.applyCursor(where, query.cursor);
    const rows = await this.tx(companyId, userId, (tx) =>
      tx.vendorLedgerEntry.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: take + 1,
        select: ENTRY_SELECT,
      }),
    );
    return buildKeysetPage(
      rows.map((row) => this.toEntryView(row)),
      take,
      (view) => ({ p: view.createdAt, t: view.id }),
    );
  }

  async listPayouts(
    companyId: string,
    userId: string,
    warehouseId: string | null,
    query: PageQuery,
  ): Promise<KeysetPage<PayoutView>> {
    const take = clampLimit(query.limit);
    const where: Prisma.VendorPayoutWhereInput = { companyId };
    if (warehouseId !== null) where.warehouseId = warehouseId;
    this.applyCursor(where, query.cursor);
    const rows = await this.tx(companyId, userId, (tx) =>
      tx.vendorPayout.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: take + 1,
        select: PAYOUT_SELECT,
      }),
    );
    return buildKeysetPage(
      rows.map((row) => this.toPayoutView(row)),
      take,
      (view) => ({ p: view.createdAt, t: view.id }),
    );
  }

  async findPayout(
    companyId: string,
    userId: string,
    payoutId: string,
  ): Promise<PayoutView | null> {
    const row = await this.tx(companyId, userId, (tx) =>
      tx.vendorPayout.findFirst({ where: { id: payoutId, companyId }, select: PAYOUT_SELECT }),
    );
    return row === null ? null : this.toPayoutView(row);
  }

  async createPayout(
    actor: WriteActor,
    input: CreatePayoutInput,
  ): Promise<{ readonly payout: PayoutView; readonly replayed: boolean }> {
    try {
      return await this.tx(actor.companyId, actor.actorId, (tx) =>
        this.createPayoutIn(tx, actor, input),
      );
    } catch (error) {
      if (!(error instanceof IdempotencyRaceSignal)) throw error;
      // A concurrent request with the same key committed first. The failed
      // transaction is aborted, so the replay reads in a fresh one.
      const replay = await this.tx(actor.companyId, actor.actorId, (tx) =>
        this.replayByKey(tx, actor.companyId, input),
      );
      if (replay === null) throw new PayoutAlreadyPendingError();
      return replay;
    }
  }

  async confirmPayout(
    actor: WriteActor,
    payoutId: string,
    input: ConfirmPayoutInput,
  ): Promise<PayoutView> {
    return this.tx(actor.companyId, actor.actorId, async (tx) => {
      const now = new Date();
      await this.assertPeriodOpen(tx, actor.companyId, now);
      const payout = await this.loadPending(tx, actor.companyId, payoutId);
      if (input.kind === "vendor" && payout.warehouseId !== input.warehouseId) {
        // Another vendor's payout: the same answer as one that does not exist.
        throw new PayoutNotFoundError();
      }
      const kind: PayoutConfirmationKind = input.kind;
      const { count } = await tx.vendorPayout.updateMany({
        where: { id: payoutId, companyId: actor.companyId, status: "pending" },
        data: {
          status: "confirmed",
          confirmationKind: kind,
          forceReason: input.kind === "forced" ? input.reason : null,
          confirmedBy: actor.actorId,
          confirmedAt: now,
          updatedBy: actor.actorId,
        },
      });
      if (count === 0) throw new PayoutNotPendingError("changed");
      return this.readPayout(tx, payoutId);
    });
  }

  async cancelPayout(actor: WriteActor, payoutId: string): Promise<PayoutView> {
    return this.tx(actor.companyId, actor.actorId, async (tx) => {
      await this.loadPending(tx, actor.companyId, payoutId);
      const { count } = await tx.vendorPayout.updateMany({
        where: { id: payoutId, companyId: actor.companyId, status: "pending" },
        data: {
          status: "cancelled",
          cancelledBy: actor.actorId,
          cancelledAt: new Date(),
          updatedBy: actor.actorId,
        },
      });
      if (count === 0) throw new PayoutNotPendingError("changed");
      // Release the rows: they are owed again and the next payout takes them.
      await tx.vendorLedgerEntry.updateMany({
        where: { payoutId, companyId: actor.companyId },
        data: { payoutId: null, updatedBy: actor.actorId },
      });
      return this.readPayout(tx, payoutId);
    });
  }

  async createAdjustment(
    actor: WriteActor,
    input: CreateAdjustmentInput,
  ): Promise<LedgerEntryView> {
    return this.tx(actor.companyId, actor.actorId, async (tx) => {
      await this.assertVendorWarehouse(tx, actor.companyId, input.warehouseId);
      const row = await tx.vendorLedgerEntry.create({
        data: {
          companyId: actor.companyId,
          warehouseId: input.warehouseId,
          kind: "adjustment",
          amountMinor: BigInt(input.amountMinor),
          note: input.note,
          createdBy: actor.actorId,
          updatedBy: actor.actorId,
        },
        select: ENTRY_SELECT,
      });
      return this.toEntryView(row);
    });
  }

  // ---- internals: payouts ----------------------------------------------------

  private async createPayoutIn(
    tx: Tx,
    actor: WriteActor,
    input: CreatePayoutInput,
  ): Promise<{ readonly payout: PayoutView; readonly replayed: boolean }> {
    const replay = await this.replayByKey(tx, actor.companyId, input);
    if (replay !== null) return replay;

    await this.assertVendorWarehouse(tx, actor.companyId, input.warehouseId);
    const pending = await tx.vendorPayout.findFirst({
      where: { companyId: actor.companyId, warehouseId: input.warehouseId, status: "pending" },
      select: { id: true },
    });
    if (pending !== null) throw new PayoutAlreadyPendingError();

    // Lock the open rows so a concurrent delivery or adjustment cannot slip
    // in between summing them and linking them: the payout carries exactly
    // the rows it was computed from.
    const open = await tx.$queryRaw<{ id: string; amount_minor: bigint }[]>`
      SELECT id, amount_minor
        FROM public.vendor_ledger_entries
       WHERE company_id = ${actor.companyId}::uuid
         AND warehouse_id = ${input.warehouseId}::uuid
         AND payout_id IS NULL
         AND NOT needs_pricing
       FOR UPDATE`;
    const owed = open.reduce((sum, row) => sum + row.amount_minor, 0n);
    if (owed <= 0n) throw new NothingToPayError(Number(owed));

    let payoutId: string;
    try {
      const created = await tx.vendorPayout.create({
        data: {
          companyId: actor.companyId,
          warehouseId: input.warehouseId,
          amountMinor: owed,
          method: input.method,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          idempotencyKey: input.idempotencyKey,
          createdBy: actor.actorId,
          updatedBy: actor.actorId,
        },
        select: { id: true },
      });
      payoutId = created.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const target = String(error.meta?.["target"] ?? "");
        if (target.includes("idempotency")) throw new IdempotencyRaceSignal();
        throw new PayoutAlreadyPendingError();
      }
      throw error;
    }

    await tx.vendorLedgerEntry.updateMany({
      where: { id: { in: open.map((row) => row.id) }, companyId: actor.companyId },
      data: { payoutId, updatedBy: actor.actorId },
    });
    return { payout: await this.readPayout(tx, payoutId), replayed: false };
  }

  /** The payout an already-used idempotency key created, or null when the key is new. */
  private async replayByKey(
    tx: Tx,
    companyId: string,
    input: CreatePayoutInput,
  ): Promise<{ readonly payout: PayoutView; readonly replayed: true } | null> {
    const existing = await tx.vendorPayout.findFirst({
      where: { companyId, idempotencyKey: input.idempotencyKey },
      select: PAYOUT_SELECT,
    });
    if (existing === null) return null;
    if (existing.warehouseId !== input.warehouseId) throw new IdempotencyKeyReusedError();
    return { payout: this.toPayoutView(existing), replayed: true };
  }

  private async loadPending(
    tx: Tx,
    companyId: string,
    payoutId: string,
  ): Promise<{ readonly warehouseId: string }> {
    const payout = await tx.vendorPayout.findFirst({
      where: { id: payoutId, companyId },
      select: { warehouseId: true, status: true },
    });
    if (payout === null) throw new PayoutNotFoundError();
    if (payout.status !== "pending") throw new PayoutNotPendingError(payout.status);
    return payout;
  }

  private async readPayout(tx: Tx, payoutId: string): Promise<PayoutView> {
    const row = await tx.vendorPayout.findFirstOrThrow({
      where: { id: payoutId },
      select: PAYOUT_SELECT,
    });
    return this.toPayoutView(row);
  }

  /**
   * No money moves inside a closed accounting period (EPIC-13, D4) — the same
   * rule every finance write follows, checked against the confirmation time.
   * Read-only here: this module never opens a period itself.
   */
  private async assertPeriodOpen(tx: Tx, companyId: string, at: Date): Promise<void> {
    const periodKey = at.toISOString().slice(0, 7);
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM public.accounting_periods
       WHERE company_id = ${companyId}::uuid AND period_key = ${periodKey}
       LIMIT 1`;
    if (rows[0]?.status === "closed") throw new PayoutPeriodClosedError(periodKey);
  }

  private async assertVendorWarehouse(
    tx: Tx,
    companyId: string,
    warehouseId: string,
  ): Promise<void> {
    const warehouse = await tx.warehouse.findFirst({
      where: { id: warehouseId, companyId, ...VENDOR_WAREHOUSE },
      select: { id: true },
    });
    if (warehouse === null) throw new VendorNotFoundError();
  }

  // ---- internals: balances ---------------------------------------------------

  /** Balances for every vendor warehouse (or just `warehouseId`), by name. */
  private async balances(
    tx: Tx,
    companyId: string,
    warehouseId: string | null,
  ): Promise<VendorBalanceView[]> {
    const scope = warehouseId === null ? {} : { warehouseId };
    const [warehouses, open, unpriced, pending, paid] = await Promise.all([
      tx.warehouse.findMany({
        where: {
          companyId,
          ...VENDOR_WAREHOUSE,
          ...(warehouseId === null ? {} : { id: warehouseId }),
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true },
      }),
      tx.vendorLedgerEntry.groupBy({
        by: ["warehouseId"],
        where: { companyId, ...scope, payoutId: null, needsPricing: false },
        _sum: { amountMinor: true },
      }),
      tx.vendorLedgerEntry.groupBy({
        by: ["warehouseId"],
        where: { companyId, ...scope, payoutId: null, needsPricing: true },
        _count: { _all: true },
      }),
      tx.vendorPayout.findMany({
        where: { companyId, ...scope, status: "pending" },
        select: { id: true, warehouseId: true, amountMinor: true },
      }),
      tx.vendorPayout.groupBy({
        by: ["warehouseId"],
        where: { companyId, ...scope, status: "confirmed" },
        _sum: { amountMinor: true },
      }),
    ]);
    const openBy = new Map(open.map((g) => [g.warehouseId, g._sum.amountMinor ?? 0n]));
    const unpricedBy = new Map(unpriced.map((g) => [g.warehouseId, g._count._all]));
    const pendingBy = new Map(pending.map((p) => [p.warehouseId, p]));
    const paidBy = new Map(paid.map((g) => [g.warehouseId, g._sum.amountMinor ?? 0n]));

    return warehouses.map((warehouse): VendorBalanceView => {
      const pendingPayout = pendingBy.get(warehouse.id);
      return {
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        // Filled in afterwards by `withVendorNames`, outside the user-bound
        // transaction (see there).
        vendorName: null,
        owedMinor: Number(openBy.get(warehouse.id) ?? 0n),
        pendingMinor: Number(pendingPayout?.amountMinor ?? 0n),
        paidMinor: Number(paidBy.get(warehouse.id) ?? 0n),
        needsPricingCount: unpricedBy.get(warehouse.id) ?? 0,
        pendingPayoutId: pendingPayout?.id ?? null,
      };
    });
  }

  // ---- internals: mapping + plumbing -----------------------------------------

  /** Newest-first keyset: rows strictly older than the cursor (ties broken by id). */
  private applyCursor(
    where: { OR?: unknown; createdAt?: unknown },
    cursor: string | undefined,
  ): void {
    if (cursor === undefined) return;
    const decoded = decodeCursor(cursor);
    const p = decoded["p"];
    const t = decoded["t"];
    if (typeof p !== "string" || typeof t !== "string") throw new InvalidCursorError();
    const at = new Date(p);
    where.OR = [{ createdAt: { lt: at } }, { AND: [{ createdAt: at }, { id: { lt: t } }] }];
  }

  private toEntryView(row: EntryRow): LedgerEntryView {
    return {
      id: row.id,
      kind: row.kind as LedgerEntryKind,
      orderId: row.orderId,
      orderNumber: row.order === null ? null : Number(row.order.orderNumber),
      variantId: row.variantId,
      nameSnapshot: row.nameSnapshot,
      quantity: row.quantity === null ? null : Number(row.quantity),
      unitCostMinor: row.unitCostMinor === null ? null : Number(row.unitCostMinor),
      amountMinor: Number(row.amountMinor),
      needsPricing: row.needsPricing,
      payoutId: row.payoutId,
      state: ledgerEntryStateOf((row.payout?.status as PayoutStatus | undefined) ?? null),
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toPayoutView(row: PayoutRow): PayoutView {
    return {
      id: row.id,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouse.name,
      amountMinor: Number(row.amountMinor),
      method: row.method as PayoutMethod,
      reference: row.reference,
      notes: row.notes,
      status: row.status as PayoutStatus,
      confirmationKind: row.confirmationKind as PayoutConfirmationKind | null,
      forceReason: row.forceReason,
      confirmedAt: row.confirmedAt === null ? null : row.confirmedAt.toISOString(),
      cancelledAt: row.cancelledAt === null ? null : row.cancelledAt.toISOString(),
      entryCount: row._count.entries,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** One transaction with the tenant and the acting user both bound. */
  private tx<T>(companyId: string, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      await setUserContext(tx, userId);
      return fn(tx);
    });
  }
}
