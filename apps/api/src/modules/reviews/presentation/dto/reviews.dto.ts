import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { PRODUCT_TYPES, type OrderReviewView } from "../../domain/review.entity";

// ---- Request DTOs -----------------------------------------------------------

/** Create-review payload (`POST /v1/reviews/orders/:orderId`). */
export class CreateReviewDto {
  @ApiProperty({ enum: PRODUCT_TYPES })
  @IsIn(PRODUCT_TYPES)
  productType!: string;

  @ApiPropertyOptional({ description: "Required (and only allowed) when productType is 'gifts'." })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  giftRecipientName?: string;

  @ApiPropertyOptional({ description: "Required (and only allowed) when productType is 'gifts'." })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  giftRecipientRelation?: string;

  @ApiPropertyOptional({ description: "Required (and only allowed) when productType is 'gifts'." })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  giftOccasion?: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  qualityRating!: number;

  @ApiPropertyOptional({ description: "Required (and only allowed) when qualityRating is 1 or 2." })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  qualityLowReason?: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  packagingRating!: number;

  @ApiPropertyOptional({
    description: "Required (and only allowed) when packagingRating is 1 or 2.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  packagingLowReason?: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  shippingRating!: number;

  @ApiPropertyOptional({
    description: "Required (and only allowed) when shippingRating is 1 or 2.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  shippingLowReason?: string;
}

// ---- Response DTOs -----------------------------------------------------------

/** A single order's review. */
export class OrderReviewDto {
  @ApiProperty({ format: "uuid" })
  id!: string;
  @ApiProperty({ format: "uuid" })
  orderId!: string;
  @ApiProperty({ format: "uuid" })
  customerId!: string;
  @ApiProperty({ enum: PRODUCT_TYPES })
  productType!: string;
  @ApiProperty({ nullable: true })
  giftRecipientName!: string | null;
  @ApiProperty({ nullable: true })
  giftRecipientRelation!: string | null;
  @ApiProperty({ nullable: true })
  giftOccasion!: string | null;
  @ApiProperty({ minimum: 1, maximum: 5 })
  qualityRating!: number;
  @ApiProperty({ nullable: true })
  qualityLowReason!: string | null;
  @ApiProperty({ minimum: 1, maximum: 5 })
  packagingRating!: number;
  @ApiProperty({ nullable: true })
  packagingLowReason!: string | null;
  @ApiProperty({ minimum: 1, maximum: 5 })
  shippingRating!: number;
  @ApiProperty({ nullable: true })
  shippingLowReason!: string | null;
  @ApiProperty({ description: "Mean of the three ratings, rounded to one decimal." })
  averageRating!: number;
  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  static from(view: OrderReviewView): OrderReviewDto {
    const dto = new OrderReviewDto();
    dto.id = view.id;
    dto.orderId = view.orderId;
    dto.customerId = view.customerId;
    dto.productType = view.productType;
    dto.giftRecipientName = view.giftRecipientName;
    dto.giftRecipientRelation = view.giftRecipientRelation;
    dto.giftOccasion = view.giftOccasion;
    dto.qualityRating = view.qualityRating;
    dto.qualityLowReason = view.qualityLowReason;
    dto.packagingRating = view.packagingRating;
    dto.packagingLowReason = view.packagingLowReason;
    dto.shippingRating = view.shippingRating;
    dto.shippingLowReason = view.shippingLowReason;
    dto.averageRating = view.averageRating;
    dto.createdAt = view.createdAt;
    return dto;
  }
}
