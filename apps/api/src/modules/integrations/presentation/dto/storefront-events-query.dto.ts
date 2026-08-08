import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";
import type {
  StorefrontEventStatus,
  StorefrontEventType,
} from "../../domain/storefront-connection.entity";
import {
  STOREFRONT_EVENT_STATUSES,
  STOREFRONT_EVENT_TYPES,
} from "../../domain/storefront-connection.entity";

/** Query params for `GET .../connections/{connectionId}/events`. */
export class StorefrontEventsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ enum: STOREFRONT_EVENT_STATUSES })
  @IsOptional()
  @IsIn(STOREFRONT_EVENT_STATUSES)
  status?: StorefrontEventStatus;

  @ApiPropertyOptional({ enum: STOREFRONT_EVENT_TYPES })
  @IsOptional()
  @IsIn(STOREFRONT_EVENT_TYPES)
  eventType?: StorefrontEventType;
}
