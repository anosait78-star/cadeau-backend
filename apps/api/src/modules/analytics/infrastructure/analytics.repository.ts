import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient, setTenantContext } from "@cadeau/database";
import type { Granularity } from "../domain/analytics-query";
import type { AnalyticsRepositoryPort, Window } from "../domain/analytics-repository.port";
import type {
  BusinessRawFacts,
  InventoryRawFacts,
  ProductPerformanceRow,
  ProfitabilityPeriodFacts,
  SparklinePoint,
  StaffPerformanceRow,
} from "../domain/analytics.entity";
import { precedingWindow } from "../domain/analytics-query";
import { ANALYTICS_PRISMA_CLIENT } from "./prisma-client.provider";

type Tx = Prisma.TransactionClient;

/** Postgres `date_trunc` unit for each granularity — whitelisted, never built from raw input (D6). */
const TRUNC_UNIT: Record<Granularity, string> = {
  day: "day",
  week: "week",
  month: "month",
};

interface SeriesRow {
  readonly bucket: Date;
  readonly order_count: bigint;
  readonly collected_minor: bigint | null;
}

interface ProductRow {
  readonly variant_id: string;
  readonly product_name: string;
  readonly variant_name: string;
  readonly units_sold: bigint | null;
  readonly revenue_minor: bigint | null;
}

interface StaffRow {
  readonly assignee_id: string | null;
  readonly assignee_name: string | null;
  readonly order_count: bigint;
  readonly collected_minor: bigint | null;
}

/**
 * Prisma-backed reads for the five analytics axes (EPIC-14, M14.2). Every
 * method binds the tenant via `setTenantContext` (RLS, ADR-0001) then reads
 * directly from tables owned by other modules — the same pattern finance's
 * `reports.controller.ts`/repository uses for its computed cash-center/P&L
 * reads (domain-map.md §5). Grouped/bucketed reads use a whitelisted raw
 * query (`TRUNC_UNIT`); every other read is a plain Prisma aggregate.
 */
@Injectable()
export class AnalyticsRepository implements AnalyticsRepositoryPort {
  constructor(@Inject(ANALYTICS_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async getBusinessFacts(
    companyId: string,
    window: Window,
    granularity: Granularity,
  ): Promise<BusinessRawFacts> {
    return this.tenantTx(companyId, async (tx) => {
      const previous = precedingWindow(window.from, window.to);

      const [current, previousAgg, seriesRows] = await Promise.all([
        tx.order.aggregate({
          where: { companyId, createdAt: { gte: window.from, lte: window.to } },
          _count: { _all: true },
          _sum: { collectedAmount: true },
        }),
        tx.order.aggregate({
          where: { companyId, createdAt: { gte: previous.from, lte: previous.to } },
          _count: { _all: true },
          _sum: { collectedAmount: true },
        }),
        tx.$queryRaw<SeriesRow[]>`
          SELECT date_trunc(${TRUNC_UNIT[granularity]}, created_at) AS bucket,
                 count(*)::bigint AS order_count,
                 sum(collected_amount)::bigint AS collected_minor
            FROM public.orders
           WHERE company_id = ${companyId}::uuid
             AND created_at BETWEEN ${window.from} AND ${window.to}
           GROUP BY bucket
           ORDER BY bucket`,
      ]);

      const series: SparklinePoint[] = seriesRows.map((row) => ({
        bucket: row.bucket.toISOString(),
        orderCount: Number(row.order_count),
        collectedMinor: Number(row.collected_minor ?? 0n),
      }));

      return {
        orderCount: current._count._all,
        collectedMinor: Number(current._sum.collectedAmount ?? 0n),
        previousOrderCount: previousAgg._count._all,
        previousCollectedMinor: Number(previousAgg._sum.collectedAmount ?? 0n),
        series,
      };
    });
  }

  async getProductPerformance(
    companyId: string,
    window: Window,
  ): Promise<readonly ProductPerformanceRow[]> {
    return this.tenantTx(companyId, async (tx) => {
      const rows = await tx.$queryRaw<ProductRow[]>`
        SELECT oi.variant_id AS variant_id,
               p.name AS product_name,
               v.name AS variant_name,
               sum(oi.quantity)::bigint AS units_sold,
               sum(oi.price * oi.quantity)::bigint AS revenue_minor
          FROM public.order_items oi
          JOIN public.product_variants v ON v.id = oi.variant_id
          JOIN public.products p ON p.id = v.product_id
         WHERE oi.company_id = ${companyId}::uuid
           AND oi.created_at BETWEEN ${window.from} AND ${window.to}
         GROUP BY oi.variant_id, p.name, v.name
         ORDER BY revenue_minor DESC`;

      return rows.map((row) => ({
        variantId: row.variant_id,
        productName: row.product_name,
        variantName: row.variant_name,
        unitsSold: Number(row.units_sold ?? 0n),
        revenueMinor: Number(row.revenue_minor ?? 0n),
      }));
    });
  }

  async getInventoryFacts(companyId: string, window: Window): Promise<InventoryRawFacts> {
    return this.tenantTx(companyId, async (tx) => {
      const [stockRows, unitsSold, onHandUnits] = await Promise.all([
        tx.$queryRaw<
          { value_minor: bigint | null; low_stock_count: bigint; out_of_stock_count: bigint }[]
        >`
          SELECT sum(s.on_hand * v.average_cost)::bigint AS value_minor,
                 count(*) FILTER (WHERE s.available > 0 AND s.available <= s.reorder_point)::bigint
                   AS low_stock_count,
                 count(*) FILTER (WHERE s.available <= 0)::bigint AS out_of_stock_count
            FROM public.inventory_stock s
            JOIN public.product_variants v ON v.id = s.variant_id
           WHERE s.company_id = ${companyId}::uuid`,
        tx.orderItem.aggregate({
          where: { companyId, createdAt: { gte: window.from, lte: window.to } },
          _sum: { quantity: true },
        }),
        tx.inventoryStock.aggregate({ where: { companyId }, _sum: { onHand: true } }),
      ]);

      const row = stockRows[0];
      return {
        onHandValueMinor: Number(row?.value_minor ?? 0n),
        lowStockCount: Number(row?.low_stock_count ?? 0n),
        outOfStockCount: Number(row?.out_of_stock_count ?? 0n),
        unitsSoldInWindow: Number(unitsSold._sum.quantity ?? 0n),
        totalOnHandUnits: Number(onHandUnits._sum.onHand ?? 0n),
      };
    });
  }

  async getStaffPerformance(
    companyId: string,
    window: Window,
  ): Promise<readonly StaffPerformanceRow[]> {
    return this.tenantTx(companyId, async (tx) => {
      const rows = await tx.$queryRaw<StaffRow[]>`
        SELECT o.assignee_id AS assignee_id,
               pr.full_name AS assignee_name,
               count(*)::bigint AS order_count,
               sum(o.collected_amount)::bigint AS collected_minor
          FROM public.orders o
          LEFT JOIN public.profiles pr ON pr.id = o.assignee_id
         WHERE o.company_id = ${companyId}::uuid
           AND o.created_at BETWEEN ${window.from} AND ${window.to}
         GROUP BY o.assignee_id, pr.full_name
         ORDER BY collected_minor DESC NULLS LAST`;

      return rows.map((row) => ({
        assigneeId: row.assignee_id,
        assigneeName: row.assignee_name ?? "Unassigned",
        orderCount: Number(row.order_count),
        collectedMinor: Number(row.collected_minor ?? 0n),
      }));
    });
  }

  async getProfitabilityFacts(
    companyId: string,
    window: Window,
  ): Promise<ProfitabilityPeriodFacts> {
    return this.tenantTx(companyId, async (tx) => {
      const [collected, cogsItems, expenses] = await Promise.all([
        tx.order.aggregate({
          where: { companyId, updatedAt: { gte: window.from, lte: window.to } },
          _sum: { collectedAmount: true },
        }),
        tx.orderItem.findMany({
          where: { companyId, order: { updatedAt: { gte: window.from, lte: window.to } } },
          select: { costSnapshot: true, quantity: true },
        }),
        tx.expense.aggregate({
          where: { companyId, incurredAt: { gte: window.from, lte: window.to } },
          _sum: { amountMinor: true },
        }),
      ]);

      const cogsMinor = Number(
        cogsItems.reduce((sum, item) => sum + item.costSnapshot * item.quantity, 0n),
      );

      return {
        collectedMinor: Number(collected._sum.collectedAmount ?? 0n),
        cogsMinor,
        expensesMinor: Number(expenses._sum.amountMinor ?? 0n),
      };
    });
  }

  private tenantTx<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return fn(tx);
    });
  }
}
