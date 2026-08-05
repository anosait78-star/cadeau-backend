import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";
import {
  ANALYTICS_AXES,
  GRANULARITIES,
  type AnalyticsAxis,
  type Granularity,
} from "../../domain/analytics-query";
import type {
  BusinessSummary,
  InventorySummary,
  ProductPerformanceRow,
  ProductsSummary,
  ProfitabilityPeriod,
  ProfitabilitySummary,
  SparklinePoint,
  StaffPerformanceRow,
  StaffSummary,
} from "../../domain/analytics.entity";

/** Shared query params for every `GET /v1/analytics/*` axis. */
export class AnalyticsWindowQueryDto {
  @ApiPropertyOptional({
    description: "ISO-8601 start of the window (default: 30 days before `to`).",
  })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: "ISO-8601 end of the window (default: now)." })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({
    enum: GRANULARITIES,
    description: "Sparkline bucket size (default: day).",
  })
  @IsOptional()
  @IsIn(GRANULARITIES)
  granularity?: Granularity;
}

/** One bucketed point on a sparkline series. */
export class SparklinePointDto {
  @ApiProperty({ example: "2026-07-01T00:00:00.000Z" })
  bucket!: string;

  @ApiProperty({ example: 12 })
  orderCount!: number;

  @ApiProperty({ example: 450000, description: "Integer minor units." })
  collectedMinor!: number;

  static from(point: SparklinePoint): SparklinePointDto {
    const dto = new SparklinePointDto();
    dto.bucket = point.bucket;
    dto.orderCount = point.orderCount;
    dto.collectedMinor = point.collectedMinor;
    return dto;
  }
}

/** Business KPI summary + deltas + sparkline (`GET /v1/analytics/business`). */
export class BusinessSummaryDto {
  @ApiProperty({ example: 42 })
  orderCount!: number;

  @ApiProperty({ example: 1500000, description: "Integer minor units." })
  collectedMinor!: number;

  @ApiProperty({ example: 35714, description: "Integer minor units." })
  averageOrderValueMinor!: number;

  @ApiPropertyOptional({ example: 12.5, nullable: true })
  orderCountDeltaPct!: number | null;

  @ApiPropertyOptional({ example: -3.2, nullable: true })
  collectedDeltaPct!: number | null;

  @ApiProperty({ type: [SparklinePointDto] })
  series!: SparklinePointDto[];

  @ApiProperty({ enum: GRANULARITIES })
  granularity!: Granularity;

  static from(view: BusinessSummary): BusinessSummaryDto {
    const dto = new BusinessSummaryDto();
    dto.orderCount = view.orderCount;
    dto.collectedMinor = view.collectedMinor;
    dto.averageOrderValueMinor = view.averageOrderValueMinor;
    dto.orderCountDeltaPct = view.orderCountDeltaPct;
    dto.collectedDeltaPct = view.collectedDeltaPct;
    dto.series = view.series.map(SparklinePointDto.from);
    dto.granularity = view.granularity;
    return dto;
  }
}

/** One variant's performance in the window. */
export class ProductPerformanceRowDto {
  @ApiProperty() variantId!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() variantName!: string;
  @ApiProperty({ example: 120 }) unitsSold!: number;
  @ApiProperty({ example: 600000, description: "Integer minor units." }) revenueMinor!: number;

  static from(row: ProductPerformanceRow): ProductPerformanceRowDto {
    const dto = new ProductPerformanceRowDto();
    dto.variantId = row.variantId;
    dto.productName = row.productName;
    dto.variantName = row.variantName;
    dto.unitsSold = row.unitsSold;
    dto.revenueMinor = row.revenueMinor;
    return dto;
  }
}

/** Top/bottom performers (`GET /v1/analytics/products`). */
export class ProductsSummaryDto {
  @ApiProperty({ type: [ProductPerformanceRowDto] })
  top!: ProductPerformanceRowDto[];

  @ApiProperty({ type: [ProductPerformanceRowDto] })
  bottom!: ProductPerformanceRowDto[];

  static from(view: ProductsSummary): ProductsSummaryDto {
    const dto = new ProductsSummaryDto();
    dto.top = view.top.map(ProductPerformanceRowDto.from);
    dto.bottom = view.bottom.map(ProductPerformanceRowDto.from);
    return dto;
  }
}

/** Stock health summary (`GET /v1/analytics/inventory`). */
export class InventorySummaryDto {
  @ApiProperty({ example: 4200000, description: "Integer minor units (Σ onHand × averageCost)." })
  onHandValueMinor!: number;

  @ApiProperty({ example: 3 })
  lowStockCount!: number;

  @ApiProperty({ example: 1 })
  outOfStockCount!: number;

  @ApiPropertyOptional({
    example: 0.35,
    nullable: true,
    description: "Units sold in the window ÷ current on-hand units — an approximate signal.",
  })
  turnoverSignal!: number | null;

  static from(view: InventorySummary): InventorySummaryDto {
    const dto = new InventorySummaryDto();
    dto.onHandValueMinor = view.onHandValueMinor;
    dto.lowStockCount = view.lowStockCount;
    dto.outOfStockCount = view.outOfStockCount;
    dto.turnoverSignal = view.turnoverSignal;
    return dto;
  }
}

/** One staff member's performance in the window. */
export class StaffPerformanceRowDto {
  @ApiPropertyOptional({ nullable: true }) assigneeId!: string | null;
  @ApiProperty() assigneeName!: string;
  @ApiProperty({ example: 18 }) orderCount!: number;
  @ApiProperty({ example: 720000, description: "Integer minor units." }) collectedMinor!: number;

  static from(row: StaffPerformanceRow): StaffPerformanceRowDto {
    const dto = new StaffPerformanceRowDto();
    dto.assigneeId = row.assigneeId;
    dto.assigneeName = row.assigneeName;
    dto.orderCount = row.orderCount;
    dto.collectedMinor = row.collectedMinor;
    return dto;
  }
}

/** Staff performance summary (`GET /v1/analytics/staff`). */
export class StaffSummaryDto {
  @ApiProperty({ type: [StaffPerformanceRowDto] })
  rows!: StaffPerformanceRowDto[];

  static from(view: StaffSummary): StaffSummaryDto {
    const dto = new StaffSummaryDto();
    dto.rows = view.rows.map(StaffPerformanceRowDto.from);
    return dto;
  }
}

/** Net-income-on-collected for one period. */
export class ProfitabilityPeriodDto {
  @ApiProperty({ example: 1500000, description: "Integer minor units." }) collectedMinor!: number;
  @ApiProperty({ example: 600000, description: "Integer minor units." }) cogsMinor!: number;
  @ApiProperty({ example: 200000, description: "Integer minor units." }) expensesMinor!: number;
  @ApiProperty({ example: 700000, description: "Integer minor units." }) netIncomeMinor!: number;

  static from(view: ProfitabilityPeriod): ProfitabilityPeriodDto {
    const dto = new ProfitabilityPeriodDto();
    dto.collectedMinor = view.collectedMinor;
    dto.cogsMinor = view.cogsMinor;
    dto.expensesMinor = view.expensesMinor;
    dto.netIncomeMinor = view.netIncomeMinor;
    return dto;
  }
}

/** Net income on collected, current + preceding window (`GET /v1/analytics/profitability`, D4). */
export class ProfitabilitySummaryDto {
  @ApiProperty({ type: ProfitabilityPeriodDto })
  current!: ProfitabilityPeriodDto;

  @ApiProperty({ type: ProfitabilityPeriodDto })
  previous!: ProfitabilityPeriodDto;

  @ApiPropertyOptional({ example: 8.4, nullable: true })
  netIncomeDeltaPct!: number | null;

  static from(view: ProfitabilitySummary): ProfitabilitySummaryDto {
    const dto = new ProfitabilitySummaryDto();
    dto.current = ProfitabilityPeriodDto.from(view.current);
    dto.previous = ProfitabilityPeriodDto.from(view.previous);
    dto.netIncomeDeltaPct = view.netIncomeDeltaPct;
    return dto;
  }
}

/** `POST /v1/analytics/export` request body. */
export class ExportRequestDto {
  @ApiProperty({ enum: ANALYTICS_AXES })
  @IsIn(ANALYTICS_AXES)
  axis!: AnalyticsAxis;

  @ApiPropertyOptional({
    description: "ISO-8601 start of the window (default: 30 days before `to`).",
  })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: "ISO-8601 end of the window (default: now)." })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ enum: GRANULARITIES })
  @IsOptional()
  @IsIn(GRANULARITIES)
  granularity?: Granularity;
}
