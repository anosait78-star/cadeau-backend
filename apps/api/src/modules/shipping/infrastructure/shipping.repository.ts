import { Inject, Injectable } from "@nestjs/common";
import {
  Prisma,
  type PrismaClient,
  setTenantContext,
  stampForCreate,
  stampForUpdate,
} from "@cadeau/database";
import { CARRIER_PORT, type CarrierPort } from "../domain/carrier.port";
import type {
  BulkShipmentResult,
  ShipmentStatusChangeResult,
  ShipmentView,
  ShipmentWriteResult,
} from "../domain/shipment.entity";
import {
  canTransition,
  isShippableOrderStatus,
  type ShipmentStatus,
} from "../domain/shipment-status";
import {
  DuplicateActiveShipmentError,
  DuplicateShipmentError,
  IllegalTransitionError,
  OrderNotShippableError,
  ReferenceNotFoundError,
} from "../domain/shipping.errors";
import type {
  CreateShipmentInput,
  ShippingRepositoryPort,
  TransitionInput,
  WriteActor,
} from "../domain/shipping-repository.port";
import { SHIPPING_PRISMA_CLIENT } from "./prisma-client.provider";

type Tx = Prisma.TransactionClient;

const SHIPMENT_SELECT = {
  id: true,
  orderId: true,
  carrier: true,
  trackingNumber: true,
  status: true,
  fee: true,
  waybillIssued: true,
  deliveredAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ShipmentRow = Prisma.ShipmentGetPayload<{ select: typeof SHIPMENT_SELECT }>;

/** Non-terminal shipment statuses — an order may hold at most one at a time. */
const ACTIVE_SHIPMENT_STATUSES: readonly ShipmentStatus[] = ["created", "picked_up", "in_transit"];

/**
 * Prisma-backed shipping repository (EPIC-12). Beyond the usual CRUD it owns:
 *
 * 1. **Tenant isolation** — `setTenantContext` binds RLS for every unit of work.
 * 2. **Carrier dispatch** (decision D1) — calls the injected {@link CarrierPort}
 *    to book/cancel a shipment; today that is always {@link ManualCarrierAdapter}.
 * 3. **Order validation** — locks the order row (`FOR UPDATE`, mirroring the
 *    EPIC-11/EPIC-9 lock idiom) and requires it to be in a shippable status
 *    before a shipment is created.
 * 4. **Fee deduction on delivery** (decision D4) — a simple subtraction from the
 *    order's `collectedAmount`, clamped at zero so the `orders_collected_check`
 *    CHECK is never violated, recorded as a `payment` order-activity row.
 *
 * Orders is a sibling module, never imported here — this repository reads/
 * writes the shared `orders`/`order_activities` tables directly under its own
 * tenant transaction, the same idiom the orders repository itself uses for the
 * EPIC-9 inventory tables.
 */
@Injectable()
export class ShippingRepository implements ShippingRepositoryPort {
  constructor(
    @Inject(SHIPPING_PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(CARRIER_PORT) private readonly carrier: CarrierPort,
  ) {}

  async findById(companyId: string, id: string): Promise<ShipmentView | null> {
    const row = await this.tenantTx(companyId, (tx) =>
      tx.shipment.findFirst({ where: { id, companyId }, select: SHIPMENT_SELECT }),
    );
    return row === null ? null : this.toView(row);
  }

  async create(actor: WriteActor, data: CreateShipmentInput): Promise<ShipmentWriteResult> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const replay = await this.findByIdempotencyKey(tx, actor.companyId, data.idempotencyKey);
      if (replay !== null) return { shipment: this.toView(replay), replayed: true };

      const lockedOrder = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status FROM public.orders
         WHERE id = ${data.orderId}::uuid AND company_id = ${actor.companyId}::uuid
         FOR UPDATE`;
      const order = lockedOrder[0];
      if (order === undefined) throw new ReferenceNotFoundError("orderId");
      if (!isShippableOrderStatus(order.status)) throw new OrderNotShippableError(order.status);

      const active = await tx.shipment.findFirst({
        where: {
          orderId: data.orderId,
          companyId: actor.companyId,
          status: { in: [...ACTIVE_SHIPMENT_STATUSES] },
        },
        select: { id: true },
      });
      if (active !== null) throw new DuplicateActiveShipmentError();

      const handle = await this.carrier.createShipment({
        companyId: actor.companyId,
        orderId: data.orderId,
      });

      try {
        const created = await tx.shipment.create({
          data: stampForCreate(actor, {
            orderId: data.orderId,
            carrier: this.carrier.name,
            trackingNumber: handle.trackingNumber,
            status: "created",
            idempotencyKey: data.idempotencyKey ?? null,
          }) as Prisma.ShipmentUncheckedCreateInput,
          select: SHIPMENT_SELECT,
        });
        return { shipment: this.toView(created), replayed: false };
      } catch (error) {
        const raced = await this.replayOnKeyConflict(
          tx,
          actor.companyId,
          data.idempotencyKey,
          error,
        );
        if (raced !== null) return { shipment: this.toView(raced), replayed: true };
        throw this.mapWriteError(error);
      }
    });
  }

  async bulkCreate(
    actor: WriteActor,
    orders: readonly CreateShipmentInput[],
  ): Promise<{ results: BulkShipmentResult[]; created: ShipmentWriteResult[] }> {
    const results: BulkShipmentResult[] = [];
    const created: ShipmentWriteResult[] = [];
    // Atomic PER ITEM: each shipment create is its own transaction, so one bad
    // order never rolls back the others (api-conventions: bulk reports per-item results).
    for (const order of orders) {
      try {
        const result = await this.create(actor, order);
        results.push({ orderId: order.orderId, ok: true, shipmentId: result.shipment.id });
        created.push(result);
      } catch (error) {
        results.push({ orderId: order.orderId, ok: false, error: this.toBulkError(error) });
      }
    }
    return { results, created };
  }

  async transition(
    actor: WriteActor,
    id: string,
    data: TransitionInput,
  ): Promise<ShipmentStatusChangeResult | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      // Lock the shipment row so concurrent transitions serialize.
      const locked = await tx.$queryRaw<
        { id: string; status: string; order_id: string; tracking_number: string; fee: bigint }[]
      >`
        SELECT id, status, order_id, tracking_number, fee
          FROM public.shipments
         WHERE id = ${id}::uuid AND company_id = ${actor.companyId}::uuid
         FOR UPDATE`;
      const row = locked[0];
      if (row === undefined) return null;
      const from = row.status as ShipmentStatus;
      const to = data.toStatus;

      if (from === to) throw new IllegalTransitionError(from, to);
      if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);

      if (to === "cancelled") await this.carrier.cancelShipment(row.tracking_number);

      let feeDeducted = 0;
      const patch: Record<string, unknown> = { status: to };
      if (to === "delivered") {
        patch["deliveredAt"] = new Date();
        feeDeducted = await this.deductShippingFee(tx, actor, row.order_id, Number(row.fee));
      }

      await tx.shipment.updateMany({
        where: { id, companyId: actor.companyId },
        data: stampForUpdate(actor, patch) as Prisma.ShipmentUncheckedUpdateManyInput,
      });
      const full = await tx.shipment.findFirstOrThrow({ where: { id }, select: SHIPMENT_SELECT });
      return { shipment: this.toView(full), fromStatus: from, toStatus: to, feeDeducted };
    });
  }

  // ---- internals: tenant tx + views -----------------------------------------

  private tenantTx<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return fn(tx);
    });
  }

  private toView(row: ShipmentRow): ShipmentView {
    return {
      id: row.id,
      orderId: row.orderId,
      carrier: row.carrier,
      trackingNumber: row.trackingNumber,
      status: row.status as ShipmentStatus,
      fee: Number(row.fee),
      waybillIssued: row.waybillIssued,
      deliveredAt: row.deliveredAt === null ? null : row.deliveredAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // ---- internals: fee deduction (decision D4) -------------------------------

  /**
   * Deduct `fee` from the order's `collectedAmount`, clamped at zero so the
   * `orders_collected_check` CHECK is never violated, and record a `payment`
   * order-activity row (the same kind orders' own service uses for a
   * collected-amount change) so the deduction is visible in the order's own
   * activity log. Returns the amount actually deducted.
   */
  private async deductShippingFee(
    tx: Tx,
    actor: WriteActor,
    orderId: string,
    fee: number,
  ): Promise<number> {
    if (fee <= 0) return 0;
    const lockedOrder = await tx.$queryRaw<{ collected_amount: bigint }[]>`
      SELECT collected_amount FROM public.orders
       WHERE id = ${orderId}::uuid AND company_id = ${actor.companyId}::uuid
       FOR UPDATE`;
    const order = lockedOrder[0];
    if (order === undefined) return 0;
    const collected = Number(order.collected_amount);
    const deducted = Math.min(fee, collected);
    if (deducted <= 0) return 0;

    await tx.order.updateMany({
      where: { id: orderId, companyId: actor.companyId },
      data: {
        collectedAmount: { decrement: BigInt(deducted) },
      } as Prisma.OrderUncheckedUpdateManyInput,
    });
    await tx.orderActivity.create({
      data: {
        companyId: actor.companyId,
        orderId,
        kind: "payment",
        toValue: String(-deducted),
        note: "Shipping fee deducted at delivery",
        actorId: actor.actorId,
      } as Prisma.OrderActivityUncheckedCreateInput,
    });
    return deducted;
  }

  // ---- internals: idempotency + error mapping -------------------------------

  private async findByIdempotencyKey(
    tx: Tx,
    companyId: string,
    key: string | null | undefined,
  ): Promise<ShipmentRow | null> {
    if (key === null || key === undefined) return null;
    return tx.shipment.findFirst({
      where: { companyId, idempotencyKey: key },
      select: SHIPMENT_SELECT,
    });
  }

  private async replayOnKeyConflict(
    tx: Tx,
    companyId: string,
    key: string | null | undefined,
    error: unknown,
  ): Promise<ShipmentRow | null> {
    if (key === null || key === undefined) return null;
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      return null;
    }
    if (!String(error.meta?.["target"] ?? "").includes("idempotency")) return null;
    return this.findByIdempotencyKey(tx, companyId, key);
  }

  private toBulkError(error: unknown): { code: string; message: string } {
    if (error instanceof OrderNotShippableError || error instanceof DuplicateActiveShipmentError) {
      return { code: "UNPROCESSABLE_ENTITY", message: error.message };
    }
    if (error instanceof ReferenceNotFoundError) {
      return { code: "UNPROCESSABLE_ENTITY", message: error.message };
    }
    return { code: "INTERNAL", message: "The shipment could not be created." };
  }

  private mapWriteError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.["target"] ?? "");
      if (target.includes("idempotency")) return new DuplicateShipmentError("idempotencyKey");
    }
    return error;
  }
}
