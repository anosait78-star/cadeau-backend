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
  readonly productName: string;
  readonly variantName: string;
  readonly unitsSold: number;
  readonly revenueMinor: number;
}

export interface ProductsSummary {
  readonly top: readonly ProductPerformanceRow[];
  readonly bottom: readonly ProductPerformanceRow[];
}

/** `GET /v1/analytics/products` */
export function getProductsAnalytics(options: AnalyticsWindow = {}): Promise<ProductsSummary> {
  return apiFetch<ProductsSummary>(`/analytics/products${buildQuery(options)}`);
}

export interface InventorySummary {
  readonly onHandValueMinor: number;
  readonly lowStockCount: number;
  readonly outOfStockCount: number;
  readonly turnoverSignal: number | null;
}

/** `GET /v1/analytics/inventory` */
export function getInventoryAnalytics(options: AnalyticsWindow = {}): Promise<InventorySummary> {
  return apiFetch<InventorySummary>(`/analytics/inventory${buildQuery(options)}`);
}

export interface StaffPerformanceRow {
  readonly assigneeId: string | null;
  readonly assigneeName: string;
  readonly orderCount: number;
  readonly collectedMinor: number;
}

export interface StaffSummary {
  readonly rows: readonly StaffPerformanceRow[];
}

/** `GET /v1/analytics/staff` */
export function getStaffAnalytics(options: AnalyticsWindow = {}): Promise<StaffSummary> {
  return apiFetch<StaffSummary>(`/analytics/staff${buildQuery(options)}`);
}

export interface ProfitabilityPeriod {
  readonly collectedMinor: number;
  readonly cogsMinor: number;
  readonly expensesMinor: number;
  readonly netIncomeMinor: number;
}

export interface ProfitabilitySummary {
  readonly current: ProfitabilityPeriod;
  readonly previous: ProfitabilityPeriod;
  readonly netIncomeDeltaPct: number | null;
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
