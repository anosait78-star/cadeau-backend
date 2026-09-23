import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, Length } from "class-validator";
import type { KeysetPage } from "@cadeau/database";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "../../domain/image-rules";
import { MAX_ORDER_REFS_PER_MESSAGE } from "../../domain/mention-rules";
import {
  SENDER_KINDS,
  THREAD_STATUSES,
  type AttachmentView,
  type MentionableOrderView,
  type MessageThreadView,
  type MessageView,
  type OrderReferenceView,
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

/** Posts a message. Order references arrive in M17.4. */
export class SendMessageDto {
  // Optional and allowed to be empty: an image-only message is valid. The
  // "text or at least one image" rule spans both fields, so the service
  // enforces it rather than a per-field decorator.
  @ApiPropertyOptional({ maxLength: BODY_MAX, default: "" })
  @IsOptional()
  @IsString()
  @Length(0, BODY_MAX)
  body?: string;

  @ApiPropertyOptional({
    type: [String],
    format: "uuid",
    maxItems: MAX_ATTACHMENTS_PER_MESSAGE,
    description: "Ids returned by the attachment upload endpoint.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTACHMENTS_PER_MESSAGE)
  @IsUUID("4", { each: true })
  attachmentIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    format: "uuid",
    maxItems: MAX_ORDER_REFS_PER_MESSAGE,
    description:
      "Orders this message points at. Each must be mentionable in this " +
      "conversation — i.e. the thread's warehouse has a group in it.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ORDER_REFS_PER_MESSAGE)
  @IsUUID("4", { each: true })
  orderIds?: string[];
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

/** One image on a message, with a short-lived link to its bytes. */
export class AttachmentDto {
  @ApiProperty({ format: "uuid" })
  id!: string;
  @ApiProperty()
  mimeType!: string;
  @ApiProperty()
  sizeBytes!: number;
  @ApiProperty()
  width!: number;
  @ApiProperty()
  height!: number;
  @ApiProperty({ description: "Expires shortly; re-fetch the message for a fresh one." })
  url!: string;

  static from(view: AttachmentView): AttachmentDto {
    const dto = new AttachmentDto();
    dto.id = view.id;
    dto.mimeType = view.mimeType;
    dto.sizeBytes = view.sizeBytes;
    dto.width = view.width;
    dto.height = view.height;
    dto.url = view.url;
    return dto;
  }
}

/**
 * An order a message points at.
 *
 * Number and status only. A vendor sees an order solely through their own
 * group in it, so the order's total — which sums every vendor's items — and
 * the customer's details stay out of the mention card.
 */
export class OrderReferenceDto {
  @ApiProperty({ format: "uuid" })
  orderId!: string;
  @ApiProperty()
  orderNumber!: string;
  @ApiProperty({ nullable: true, description: "Null if the order no longer exists." })
  status!: string | null;

  static from(view: OrderReferenceView): OrderReferenceDto {
    const dto = new OrderReferenceDto();
    dto.orderId = view.orderId;
    dto.orderNumber = view.orderNumber;
    dto.status = view.status;
    return dto;
  }
}

/** An order the `@` picker offers. */
export class MentionableOrderDto {
  @ApiProperty({ format: "uuid" })
  orderId!: string;
  @ApiProperty()
  orderNumber!: string;
  @ApiProperty()
  status!: string;
  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  static from(view: MentionableOrderView): MentionableOrderDto {
    const dto = new MentionableOrderDto();
    dto.orderId = view.orderId;
    dto.orderNumber = view.orderNumber;
    dto.status = view.status;
    dto.createdAt = view.createdAt;
    return dto;
  }
}

/** The orders that may be mentioned in one conversation. */
export class MentionableOrderListDto {
  @ApiProperty({ type: [MentionableOrderDto] })
  data!: MentionableOrderDto[];

  static from(views: readonly MentionableOrderView[]): MentionableOrderListDto {
    const dto = new MentionableOrderListDto();
    dto.data = views.map((v) => MentionableOrderDto.from(v));
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
  @ApiProperty({ nullable: true, description: "Null once deleted, or image-only." })
  body!: string | null;
  @ApiProperty({ type: [AttachmentDto] })
  attachments!: AttachmentDto[];
  @ApiProperty({ type: [OrderReferenceDto] })
  orderRefs!: OrderReferenceDto[];
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
    dto.attachments = view.attachments.map((a) => AttachmentDto.from(a));
    dto.orderRefs = view.orderRefs.map((r) => OrderReferenceDto.from(r));
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
