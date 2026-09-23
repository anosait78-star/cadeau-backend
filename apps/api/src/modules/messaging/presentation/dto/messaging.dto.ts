import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsString, IsUUID, Length } from "class-validator";
import type { KeysetPage } from "@cadeau/database";
import {
  SENDER_KINDS,
  THREAD_STATUSES,
  type MessageThreadView,
  type MessageView,
} from "../../domain/message.entity";
import type { VendorWarehouseView } from "../../domain/messaging-repository.port";

/** Longest message body the `messages_body_check` constraint accepts. */
const BODY_MAX = 4000;

// ---- Request DTOs --------------------------------------------------------------

/** Opens (or reuses) the conversation with one vendor. */
export class OpenThreadDto {
  @ApiProperty({ format: "uuid", description: "The vendor's warehouse." })
  @IsUUID()
  warehouseId!: string;
}

/** Posts a message. Attachments and order references arrive in M17.3/M17.4. */
export class SendMessageDto {
  @ApiProperty({ minLength: 1, maxLength: BODY_MAX })
  @IsString()
  @Length(1, BODY_MAX)
  body!: string;
}

// ---- Response DTOs -------------------------------------------------------------

/** One vendor conversation. */
export class MessageThreadDto {
  @ApiProperty({ format: "uuid" })
  id!: string;
  @ApiProperty({ format: "uuid" })
  warehouseId!: string;
  @ApiProperty()
  warehouseName!: string;
  @ApiProperty({ format: "uuid" })
  vendorMemberId!: string;
  @ApiProperty({ enum: THREAD_STATUSES })
  status!: string;
  @ApiProperty({ format: "date-time", nullable: true })
  lastMessageAt!: string | null;
  @ApiPropertyOptional({ nullable: true })
  lastMessagePreview!: string | null;
  @ApiProperty({ description: "Unread messages for the calling member only." })
  unreadCount!: number;
  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  static from(view: MessageThreadView): MessageThreadDto {
    const dto = new MessageThreadDto();
    dto.id = view.id;
    dto.warehouseId = view.warehouseId;
    dto.warehouseName = view.warehouseName;
    dto.vendorMemberId = view.vendorMemberId;
    dto.status = view.status;
    dto.lastMessageAt = view.lastMessageAt;
    dto.lastMessagePreview = view.lastMessagePreview;
    dto.unreadCount = view.unreadCount;
    dto.createdAt = view.createdAt;
    return dto;
  }
}

/** One message in a conversation. */
export class MessageDto {
  @ApiProperty({ format: "uuid" })
  id!: string;
  @ApiProperty({ format: "uuid" })
  threadId!: string;
  @ApiProperty({ format: "uuid" })
  senderProfileId!: string;
  @ApiProperty({ nullable: true })
  senderName!: string | null;
  @ApiProperty({ enum: SENDER_KINDS })
  senderKind!: string;
  @ApiProperty({ nullable: true, description: "Null once deleted." })
  body!: string | null;
  @ApiProperty({ format: "date-time", nullable: true })
  deletedAt!: string | null;
  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  static from(view: MessageView): MessageDto {
    const dto = new MessageDto();
    dto.id = view.id;
    dto.threadId = view.threadId;
    dto.senderProfileId = view.senderProfileId;
    dto.senderName = view.senderName;
    dto.senderKind = view.senderKind;
    dto.body = view.body;
    dto.deletedAt = view.deletedAt;
    dto.createdAt = view.createdAt;
    return dto;
  }
}

/** A vendor the caller could start a conversation with. */
export class VendorWarehouseDto {
  @ApiProperty({ format: "uuid" })
  warehouseId!: string;
  @ApiProperty()
  warehouseName!: string;
  @ApiProperty({ format: "uuid" })
  vendorMemberId!: string;
  @ApiProperty({ format: "uuid", nullable: true, description: "Null until someone writes." })
  threadId!: string | null;

  static from(view: VendorWarehouseView): VendorWarehouseDto {
    const dto = new VendorWarehouseDto();
    dto.warehouseId = view.warehouseId;
    dto.warehouseName = view.warehouseName;
    dto.vendorMemberId = view.vendorMemberId;
    dto.threadId = view.threadId;
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

/** The keyset-paged thread list envelope. */
export class MessageThreadListDto {
  @ApiProperty({ type: [MessageThreadDto] })
  data!: MessageThreadDto[];
  @ApiProperty({ type: PageDto })
  page!: PageDto;

  static from(page: KeysetPage<MessageThreadView>): MessageThreadListDto {
    const dto = new MessageThreadListDto();
    dto.data = page.data.map((t) => MessageThreadDto.from(t));
    dto.page = page.page;
    return dto;
  }
}

/** The keyset-paged message list envelope. */
export class MessageListDto {
  @ApiProperty({ type: [MessageDto] })
  data!: MessageDto[];
  @ApiProperty({ type: PageDto })
  page!: PageDto;

  static from(page: KeysetPage<MessageView>): MessageListDto {
    const dto = new MessageListDto();
    dto.data = page.data.map((m) => MessageDto.from(m));
    dto.page = page.page;
    return dto;
  }
}

/** The vendors a staff member could open a conversation with. */
export class VendorWarehouseListDto {
  @ApiProperty({ type: [VendorWarehouseDto] })
  data!: VendorWarehouseDto[];

  static from(views: readonly VendorWarehouseView[]): VendorWarehouseListDto {
    const dto = new VendorWarehouseListDto();
    dto.data = views.map((v) => VendorWarehouseDto.from(v));
    return dto;
  }
}

/** Where the caller's read cursor now sits. */
export class ReadCursorDto {
  @ApiProperty({ format: "date-time" })
  lastReadAt!: string;

  static from(result: { lastReadAt: string }): ReadCursorDto {
    const dto = new ReadCursorDto();
    dto.lastReadAt = result.lastReadAt;
    return dto;
  }
}
