import { apiFetch, apiFetchBlob } from "@/lib/api-client";

/** Shared query for every `/v1/analytics/*` axis (EPIC-14). */
export interface AnalyticsWindow {
  readonly from?: string;
  readonly to?: string;
  readonly granularity?: "day" | "week" | "month";
}

function buildQuery(options: AnalyticsWindow): string {
  const params = new URLSearchParams();
  if (options.from !== undefined) params.set("from", options.from);
  if (options.to !== undefined) params.set("to", options.to);
  if (options.granularity !== undefined) params.set("granularity", options.granularity);
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

export interface SparklinePoint {
  readonly bucket: string;
  readonly orderCount: number;
  readonly collectedMinor: number;
}

export interface BusinessSummary {
  readonly orderCount: number;
  readonly collectedMinor: number;
  readonly averageOrderValueMinor: number;
  readonly orderCountDeltaPct: number | null;
  readonly collectedDeltaPct: number | null;
  readonly series: readonly SparklinePoint[];
  readonly granularity: "day" | "week" | "month";
}

/** `GET /v1/analytics/business` */
export function getBusinessAnalytics(options: AnalyticsWindow = {}): Promise<BusinessSummary> {
  return apiFetch<BusinessSummary>(`/analytics/business${buildQuery(options)}`);
}

export interface ProductPerformanceRow {
  readonly variantId: string;
  readonly productId: string;
  /** The parent product's display image, when it has one. */
  readonly imageUrl: string | null;
  readonly productName: string;
  readonly variantName: string;
  readonly unitsSold: number;
  readonly revenueMinor: number;
}

/** Catalogue + sales headline numbers for one window. */
export interface ProductsTotals {
  readonly activeProducts: number;
  readonly newProducts: number;
  readonly unitsSold: number;
  readonly revenueMinor: number;
  readonly averagePriceMinor: number;
}

export interface ProductsSummary {
  readonly top: readonly ProductPerformanceRow[];
  readonly bottom: readonly ProductPerformanceRow[];
  readonly totals: ProductsTotals;
  /** The same totals over the preceding window of equal length. */
  readonly previous: ProductsTotals;
}

/** `GET /v1/analytics/products` */
export function getProductsAnalytics(options: AnalyticsWindow = {}): Promise<ProductsSummary> {
  return apiFetch<ProductsSummary>(`/analytics/products${buildQuery(options)}`);
}

export interface ProfitabilityPeriod {
  readonly collectedMinor: number;
  readonly cogsMinor: number;
  readonly expensesMinor: number;
  readonly netIncomeMinor: number;
}

/** One bucket of the profitability series. */
export interface ProfitabilityPoint extends ProfitabilityPeriod {
  readonly bucket: string;
}

export interface ProfitabilitySummary {
  readonly current: ProfitabilityPeriod;
  readonly previous: ProfitabilityPeriod;
  readonly netIncomeDeltaPct: number | null;
  /** The window split by the requested granularity, oldest bucket first. */
  readonly series: readonly ProfitabilityPoint[];
  readonly granularity: "day" | "week" | "month";
}

/** `GET /v1/analytics/profitability` (net income on collected − COGS − expenses, D4) */
export function getProfitabilityAnalytics(
  options: AnalyticsWindow = {},
): Promise<ProfitabilitySummary> {
  return apiFetch<ProfitabilitySummary>(`/analytics/profitability${buildQuery(options)}`);
}

export type AnalyticsAxis = "business" | "products" | "inventory" | "staff" | "profitability";

/**
 * `POST /v1/analytics/export` — downloads the computed view for one axis as
 * a CSV file (restricted to `analytics.manage`, audited server-side, D1/D7).
 */
export async function exportAnalytics(
  axis: AnalyticsAxis,
  options: AnalyticsWindow = {},
): Promise<void> {
  const blob = await apiFetchBlob("/analytics/export", {
    method: "POST",
    body: { axis, ...options },
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `analytics-${axis}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
