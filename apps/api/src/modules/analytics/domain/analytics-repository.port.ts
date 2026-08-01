import type { Granularity } from "./analytics-query";
import type {
  BusinessRawFacts,
  InventoryRawFacts,
  ProductPerformanceRow,
  ProfitabilityPeriodFacts,
  StaffPerformanceRow,
} from "./analytics.entity";

/** A validated `[from, to]` window. */
export interface Window {
  readonly from: Date;
  readonly to: Date;
}

/**
 * Port for the read-only aggregate queries backing the five analytics axes
 * (EPIC-14, M14.2). Every method is scoped to one company (tenant from the
 * token, never the payload — ADR-0001) and reads existing tables owned by
 * other modules (products, inventory, orders, finance) directly, the same
 * way finance's `reports.controller.ts` reads across `orders`/`expenses`
 * (domain-map.md §5: analytics reads across everything, owns nothing).
 */
export interface AnalyticsRepositoryPort {
  getBusinessFacts(
    companyId: string,
    window: Window,
    granularity: Granularity,
  ): Promise<BusinessRawFacts>;

  getProductPerformance(
    companyId: string,
    window: Window,
  ): Promise<readonly ProductPerformanceRow[]>;

  getInventoryFacts(companyId: string, window: Window): Promise<InventoryRawFacts>;

  getStaffPerformance(companyId: string, window: Window): Promise<readonly StaffPerformanceRow[]>;

  getProfitabilityFacts(companyId: string, window: Window): Promise<ProfitabilityPeriodFacts>;
}

/** DI token for {@link AnalyticsRepositoryPort}. */
export const ANALYTICS_REPOSITORY = Symbol("ANALYTICS_REPOSITORY");
