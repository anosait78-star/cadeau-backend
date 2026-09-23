import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { AccessGuard } from "../../../shared/access/access.guard";
import { RequireCapability } from "../../../shared/access/require-capability.decorator";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { CurrentUser } from "../../../shared/auth/current-user.decorator";
import { JwtAuthGuard } from "../../../shared/auth/jwt-auth.guard";
import { MessagingService } from "../application/messaging.service";
import {
  MessageDto,
  MessageListDto,
  MessageThreadDto,
  MessageThreadListDto,
  OpenThreadDto,
  ReadCursorDto,
  SendMessageDto,
  VendorWarehouseListDto,
} from "./dto/messaging.dto";

/** The feature key this module is gated under (access catalog). */
const MESSAGING_FEATURE = "messaging";

/** Raw list-query params as they arrive (all strings). */
interface RawListQuery {
  readonly limit?: string;
  readonly cursor?: string;
}

/**
 * Vendor conversation endpoints under `/v1/messaging`.
 *
 * Both sides of a conversation use these routes. `messaging.read` covers
 * looking, `messaging.send` covers writing, and `messaging.manage` covers the
 * staff-only routes — listing every conversation in the company and starting a
 * new one. A vendor holds only the first two, so those routes are closed to
 * them by the guard before the service is reached; which single conversation
 * they may see is then decided by {@link MessagingService} and, independently,
 * by the `message_threads` RLS policy.
 *
 * The tenant always comes from the token, never the payload (ADR-003).
 */
@ApiTags("messaging")
@Controller("messaging")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class MessagingController {
  constructor(private readonly service: MessagingService) {}

  @Get("threads")
  @RequireCapability({ feature: MESSAGING_FEATURE, permission: "messaging.read" })
  @ApiOperation({
    summary: "List conversations the caller can see (a vendor sees only their own)",
    operationId: "listMessageThreads",
  })
  @ApiOkResponse({ type: MessageThreadListDto })
  async listThreads(
    @CurrentUser() principal: RequestPrincipal,
    @Query() rawQuery: RawListQuery,
  ): Promise<MessageThreadListDto> {
    const page = await this.service.listThreads(principal, {
      ...(rawQuery.limit === undefined ? {} : { limit: Number(rawQuery.limit) }),
      ...(rawQuery.cursor === undefined ? {} : { cursor: rawQuery.cursor }),
    });
    return MessageThreadListDto.from(page);
  }

  @Get("threads/me")
  @RequireCapability({ feature: MESSAGING_FEATURE, permission: "messaging.read" })
  @ApiOperation({
    summary: "The calling vendor's own conversation, created on first open",
    operationId: "getOwnMessageThread",
  })
  @ApiOkResponse({ type: MessageThreadDto })
  async getOwnThread(@CurrentUser() principal: RequestPrincipal): Promise<MessageThreadDto> {
    return MessageThreadDto.from(await this.service.getOwnThread(principal));
  }

  @Get("vendors")
  @RequireCapability({ feature: MESSAGING_FEATURE, permission: "messaging.manage" })
  @ApiOperation({
    summary: "The vendors a conversation can be started with",
    operationId: "listMessagingVendors",
  })
  @ApiOkResponse({ type: VendorWarehouseListDto })
  async listVendors(@CurrentUser() principal: RequestPrincipal): Promise<VendorWarehouseListDto> {
    return VendorWarehouseListDto.from(await this.service.listVendorWarehouses(principal));
  }

  @Post("threads")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: MESSAGING_FEATURE, permission: "messaging.manage" })
  @ApiOperation({
    // 200, not 201: "open" is get-or-create, and the caller does not care
    // which of the two happened.
    summary: "Open the conversation with one vendor, creating it if needed",
    operationId: "openMessageThread",
  })
  @ApiOkResponse({ type: MessageThreadDto })
  async openThread(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: OpenThreadDto,
  ): Promise<MessageThreadDto> {
    return MessageThreadDto.from(await this.service.openThread(principal, body.warehouseId));
  }

  @Get("threads/:threadId/messages")
  @RequireCapability({ feature: MESSAGING_FEATURE, permission: "messaging.read" })
  @ApiOperation({ summary: "One page of a conversation", operationId: "listMessages" })
  @ApiOkResponse({ type: MessageListDto })
  async listMessages(
    @CurrentUser() principal: RequestPrincipal,
    @Param("threadId", ParseUUIDPipe) threadId: string,
    @Query() rawQuery: RawListQuery,
  ): Promise<MessageListDto> {
    const page = await this.service.listMessages(principal, threadId, {
      ...(rawQuery.limit === undefined ? {} : { limit: Number(rawQuery.limit) }),
      ...(rawQuery.cursor === undefined ? {} : { cursor: rawQuery.cursor }),
    });
    return MessageListDto.from(page);
  }

  @Post("threads/:threadId/messages")
  @HttpCode(HttpStatus.CREATED)
  @RequireCapability({ feature: MESSAGING_FEATURE, permission: "messaging.send" })
  @ApiOperation({ summary: "Post a message to a conversation", operationId: "sendMessage" })
  @ApiCreatedResponse({ type: MessageDto })
  async sendMessage(
    @CurrentUser() principal: RequestPrincipal,
    @Param("threadId", ParseUUIDPipe) threadId: string,
    @Body() body: SendMessageDto,
  ): Promise<MessageDto> {
    return MessageDto.from(
      await this.service.sendMessage(principal, threadId, { body: body.body }),
    );
  }

  @Post("threads/:threadId/read")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: MESSAGING_FEATURE, permission: "messaging.read" })
  @ApiOperation({
    summary: "Move the caller's own read cursor to now",
    operationId: "markThreadRead",
  })
  @ApiOkResponse({ type: ReadCursorDto })
  async markRead(
    @CurrentUser() principal: RequestPrincipal,
    @Param("threadId", ParseUUIDPipe) threadId: string,
  ): Promise<ReadCursorDto> {
    return ReadCursorDto.from(await this.service.markRead(principal, threadId));
  }
}
