import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import type { KeysetPage } from "@cadeau/database";
import { NOTIFICATION_TYPES, type NotificationType } from "../../domain/notification-types";
import type {
  NotificationPreferenceView,
  NotificationView,
  PushSubscriptionView,
} from "../../domain/notification.entity";

/** The most ids one mark-read request may touch (api-conventions bulk-shape precedent). */
export const MARK_READ_MAX = 100;

// ---- Request DTOs -----------------------------------------------------------

/** `POST /v1/notifications/read` payload (decision D8 — idempotent, no header needed). */
export class MarkReadDto {
  @ApiProperty({ type: [String], format: "uuid", minItems: 1, maxItems: MARK_READ_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MARK_READ_MAX)
  @IsUUID("4", { each: true })
  ids!: string[];
}

/** One per-type channel preference in a `PUT /v1/notifications/preferences` request. */
export class NotificationPreferenceInputDto {
  @ApiProperty({ enum: NOTIFICATION_TYPES })
  @IsIn(NOTIFICATION_TYPES)
  type!: NotificationType;

  @ApiProperty()
  @IsBoolean()
  inAppEnabled!: boolean;

  @ApiProperty()
  @IsBoolean()
  webPushEnabled!: boolean;
}

export class UpdatePreferencesDto {
  @ApiProperty({ type: [NotificationPreferenceInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceInputDto)
  preferences!: NotificationPreferenceInputDto[];
}

/** The W3C `PushSubscriptionKeys` shape. */
export class PushSubscriptionKeysDto {
  @ApiProperty({ description: "Base64url P-256 public key." })
  @IsString()
  @MaxLength(200)
  p256dh!: string;

  @ApiProperty({ description: "Base64url authentication secret." })
  @IsString()
  @MaxLength(200)
  auth!: string;
}

/** The W3C `PushSubscription.toJSON()` shape — registering an endpoint. */
export class RegisterPushSubscriptionDto {
  @ApiProperty()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  endpoint!: string;

  @ApiProperty({ type: PushSubscriptionKeysDto })
  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys!: PushSubscriptionKeysDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  userAgent?: string;
}

// ---- Response DTOs -----------------------------------------------------------

/** One in-app notification. */
export class NotificationDto {
  @ApiProperty({ format: "uuid" })
  id!: string;
  @ApiProperty({ enum: NOTIFICATION_TYPES })
  type!: string;
  @ApiProperty()
  title!: string;
  @ApiProperty()
  body!: string;
  @ApiPropertyOptional({ nullable: true })
  payload!: unknown;
  @ApiProperty({ format: "date-time", nullable: true })
  readAt!: string | null;
  @ApiProperty({ format: "date-time" })
  createdAt!: string;
  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  static from(view: NotificationView): NotificationDto {
    const dto = new NotificationDto();
    dto.id = view.id;
    dto.type = view.type;
    dto.title = view.title;
    dto.body = view.body;
    dto.payload = view.payload;
    dto.readAt = view.readAt;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}

class PageDto {
  @ApiProperty()
  limit!: number;
  @ApiProperty({ nullable: true })
  nextCursor!: string | null;
  @ApiProperty()
  hasMore!: boolean;
}

/** The keyset-paged notification list envelope. */
export class NotificationListDto {
  @ApiProperty({ type: [NotificationDto] })
  data!: NotificationDto[];
  @ApiProperty({ type: PageDto })
  page!: PageDto;

  static from(page: KeysetPage<NotificationView>): NotificationListDto {
    const dto = new NotificationListDto();
    dto.data = page.data.map((n) => NotificationDto.from(n));
    dto.page = page.page;
    return dto;
  }
}

/** The result of a mark-read request. */
export class MarkReadResultDto {
  @ApiProperty({ description: "How many of the requested ids were newly marked read." })
  updated!: number;

  static from(result: { updated: number }): MarkReadResultDto {
    const dto = new MarkReadResultDto();
    dto.updated = result.updated;
    return dto;
  }
}

/** One per-type channel preference. */
export class NotificationPreferenceDto {
  @ApiProperty({ enum: NOTIFICATION_TYPES })
  type!: string;
  @ApiProperty()
  inAppEnabled!: boolean;
  @ApiProperty()
  webPushEnabled!: boolean;

  static from(view: NotificationPreferenceView): NotificationPreferenceDto {
    const dto = new NotificationPreferenceDto();
    dto.type = view.type;
    dto.inAppEnabled = view.inAppEnabled;
    dto.webPushEnabled = view.webPushEnabled;
    return dto;
  }
}

export class NotificationPreferenceListDto {
  @ApiProperty({ type: [NotificationPreferenceDto] })
  data!: NotificationPreferenceDto[];

  static from(views: readonly NotificationPreferenceView[]): NotificationPreferenceListDto {
    const dto = new NotificationPreferenceListDto();
    dto.data = views.map((v) => NotificationPreferenceDto.from(v));
    return dto;
  }
}

/** A registered Web Push subscription. */
export class PushSubscriptionDto {
  @ApiProperty({ format: "uuid" })
  id!: string;
  @ApiProperty()
  endpoint!: string;
  @ApiPropertyOptional({ nullable: true })
  userAgent!: string | null;
  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  static from(view: PushSubscriptionView): PushSubscriptionDto {
    const dto = new PushSubscriptionDto();
    dto.id = view.id;
    dto.endpoint = view.endpoint;
    dto.userAgent = view.userAgent;
    dto.createdAt = view.createdAt;
    return dto;
  }
}
