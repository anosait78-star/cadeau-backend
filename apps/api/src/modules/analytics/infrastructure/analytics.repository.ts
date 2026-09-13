import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient, setTenantContext } from "@cadeau/database";
import type { Granularity } from "../domain/analytics-query";
import type { AnalyticsRepositoryPort, Window } from "../domain/analytics-repository.port";
import type {
  BusinessRawFacts,
  InventoryRawFacts,
  ProductPerformanceRow,
  ProductsRawTotals,
  ProfitabilityPeriodFacts,
  ProfitabilityPointFacts,
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

/**
 * Order states whose lines never count as sales: money that came back or was
 * never taken. Product revenue and unit counts exclude them (2026-09-14
 * decision) — a cancelled order is not a sale of its lines.
 */
const VOID_ORDER_STATUSES = ["cancelled", "returned"];

interface SeriesRow {
  readonly bucket: Date;
  readonly order_count: bigint;
  readonly collected_minor: bigint | null;
}

interface ProductRow {
  readonly variant_id: string;
  readonly product_id: string;
  readonly image_url: string | null;
  readonly product_name: string;
  readonly variant_name: string;
  readonly units_sold: bigint | null;
  readonly revenue_minor: bigint | null;
}

interface ProductTotalsRow {
  readonly units_sold: bigint | null;
  readonly revenue_minor: bigint | null;
}

interface ProfitabilityBucketRow {
  readonly bucket: Date;
  readonly collected_minor: bigint | null;
  readonly cogs_minor: bigint | null;
  readonly expenses_minor: bigint | null;
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
               p.id AS product_id,
               p.image_url AS image_url,
               p.name AS product_name,
               v.name AS variant_name,
               sum(oi.quantity)::bigint AS units_sold,
               sum(oi.price * oi.quantity)::bigint AS revenue_minor
          FROM public.order_items oi
          JOIN public.orders o ON o.id = oi.order_id
          JOIN public.product_variants v ON v.id = oi.variant_id
          JOIN public.products p ON p.id = v.product_id
         WHERE oi.company_id = ${companyId}::uuid
           AND oi.created_at BETWEEN ${window.from} AND ${window.to}
           AND o.status NOT IN (${Prisma.join(VOID_ORDER_STATUSES)})
         GROUP BY oi.variant_id, p.id, p.image_url, p.name, v.name
         ORDER BY revenue_minor DESC`;

      return rows.map((row) => ({
        variantId: row.variant_id,
        productId: row.product_id,
        imageUrl: row.image_url,
        productName: row.product_name,
        variantName: row.variant_name,
        unitsSold: Number(row.units_sold ?? 0n),
        revenueMinor: Number(row.revenue_minor ?? 0n),
      }));
    });
  }

  async getProductsTotals(companyId: string, window: Window): Promise<ProductsRawTotals> {
    return this.tenantTx(companyId, async (tx) => {
      const [activeProducts, newProducts, sold] = await Promise.all([
        tx.product.count({ where: { companyId, isActive: true } }),
        tx.product.count({
          where: { companyId, createdAt: { gte: window.from, lte: window.to } },
        }),
        tx.$queryRaw<ProductTotalsRow[]>`
          SELECT sum(oi.quantity)::bigint AS units_sold,
                 sum(oi.price * oi.quantity)::bigint AS revenue_minor
            FROM public.order_items oi
            JOIN public.orders o ON o.id = oi.order_id
           WHERE oi.company_id = ${companyId}::uuid
             AND oi.created_at BETWEEN ${window.from} AND ${window.to}
             AND o.status NOT IN (${Prisma.join(VOID_ORDER_STATUSES)})`,
      ]);

      const totals = sold[0];
      return {
        activeProducts,
        newProducts,
        unitsSold: Number(totals?.units_sold ?? 0n),
        revenueMinor: Number(totals?.revenue_minor ?? 0n),
      };
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

  /**
   * What the window collected, what its goods cost, and what was spent.
   *
   * Orders are keyed on `created_at`, matching `getBusinessFacts` and the
   * dashboard's collected figure. `updated_at` is the wrong key here, however
   * intuitive it looks: `collected_amount` is a running total on the order
   * row, not a timestamped payment, so summing it by the row's last touch
   * credits an order's entire lifetime collection to whatever period someone
   * last changed its status in — an order from months ago, nudged yesterday,
   * lands whole in this month. That inflated analytics far past the same
   * measure on the dashboard (2026-09-14). `created_at` is an approximation
   * too — money is collected after the order is placed, not when — but it is
   * stable, never double-attributes, and agrees with every other figure on
   * this page. Finance's cash center still keys on `updated_at`; the two will
   * only truly agree once a payment-event ledger exists.
   */
  async getProfitabilityFacts(
    companyId: string,
    window: Window,
  ): Promise<ProfitabilityPeriodFacts> {
    return this.tenantTx(companyId, async (tx) => {
      const [collected, cogsItems, expenses] = await Promise.all([
        tx.order.aggregate({
          where: { companyId, createdAt: { gte: window.from, lte: window.to } },
          _sum: { collectedAmount: true },
        }),
        tx.orderItem.findMany({
          where: { companyId, order: { createdAt: { gte: window.from, lte: window.to } } },
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

  async getProfitabilitySeries(
    companyId: string,
    window: Window,
    granularity: Granularity,
  ): Promise<readonly ProfitabilityPointFacts[]> {
    return this.tenantTx(companyId, async (tx) => {
      /*
       * One bucketed row per period, from three sources that share no table:
       * what orders collected and what their lines cost (both keyed on the
       * order's `created_at`, as `getProfitabilityFacts` does) and what was
       * spent (keyed on the expense's `incurred_at`). A union of three
       * single-source shapes summed per bucket, so a period missing from one
       * source still appears with a zero for it.
       */
      const rows = await tx.$queryRaw<ProfitabilityBucketRow[]>`
        SELECT bucket,
               sum(collected_minor)::bigint AS collected_minor,
               sum(cogs_minor)::bigint AS cogs_minor,
               sum(expenses_minor)::bigint AS expenses_minor
          FROM (
            SELECT date_trunc(${TRUNC_UNIT[granularity]}, o.created_at) AS bucket,
                   sum(o.collected_amount) AS collected_minor,
                   0::bigint AS cogs_minor,
                   0::bigint AS expenses_minor
              FROM public.orders o
             WHERE o.company_id = ${companyId}::uuid
               AND o.created_at BETWEEN ${window.from} AND ${window.to}
             GROUP BY bucket
            UNION ALL
            SELECT date_trunc(${TRUNC_UNIT[granularity]}, o.created_at) AS bucket,
                   0::bigint AS collected_minor,
                   sum(oi.cost_snapshot * oi.quantity) AS cogs_minor,
                   0::bigint AS expenses_minor
              FROM public.order_items oi
              JOIN public.orders o ON o.id = oi.order_id
             WHERE oi.company_id = ${companyId}::uuid
               AND o.created_at BETWEEN ${window.from} AND ${window.to}
             GROUP BY bucket
            UNION ALL
            SELECT date_trunc(${TRUNC_UNIT[granularity]}, e.incurred_at) AS bucket,
                   0::bigint AS collected_minor,
                   0::bigint AS cogs_minor,
                   sum(e.amount_minor) AS expenses_minor
              FROM public.expenses e
             WHERE e.company_id = ${companyId}::uuid
               AND e.incurred_at BETWEEN ${window.from} AND ${window.to}
             GROUP BY bucket
          ) parts
         GROUP BY bucket
         ORDER BY bucket`;

      return rows.map((row) => ({
        bucket: row.bucket.toISOString(),
        collectedMinor: Number(row.collected_minor ?? 0n),
        cogsMinor: Number(row.cogs_minor ?? 0n),
        expensesMinor: Number(row.expenses_minor ?? 0n),
      }));
    });
  }

  private tenantTx<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return fn(tx);
    });
  }
}
