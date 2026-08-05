import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AccessGuard } from "../../../shared/access/access.guard";
import { RequireCapability } from "../../../shared/access/require-capability.decorator";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { CurrentUser } from "../../../shared/auth/current-user.decorator";
import { JwtAuthGuard } from "../../../shared/auth/jwt-auth.guard";
import { NotificationsService } from "../application/notifications.service";
import type { RawNotificationListQuery } from "../domain/list-query";
import {
  MarkReadDto,
  MarkReadResultDto,
  NotificationListDto,
  NotificationPreferenceListDto,
  PushSubscriptionDto,
  RegisterPushSubscriptionDto,
  UpdatePreferencesDto,
} from "./dto/notifications.dto";

/** The feature key this module is gated under (access catalog). */
const NOTIFICATIONS_FEATURE = "notifications";

/**
 * Personal notification endpoints under `/v1/notifications`
 * (contract: docs/api/notifications.md).
 *
 * Every route requires a valid access token and the `notifications` feature
 * being active for the company — **and nothing else** (decision D1). These
 * are exclusively the caller's own data (their inbox, their preferences,
 * their push subscriptions), so no `permission` is set on
 * {@link RequireCapability}: gating this by a role permission would let one
 * role block a teammate from muting their own push notifications, the same
 * reasoning `GET /v1/me` follows.
 */
@ApiTags("notifications")
@Controller("notifications")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @RequireCapability({ feature: NOTIFICATIONS_FEATURE })
  @ApiOperation({
    summary: "List the caller's own notifications",
    operationId: "listNotifications",
  })
  @ApiOkResponse({ type: NotificationListDto })
  async list(
    @CurrentUser() principal: RequestPrincipal,
    @Query() rawQuery: RawNotificationListQuery,
  ): Promise<NotificationListDto> {
    const page = await this.service.list(principal, rawQuery);
    return NotificationListDto.from(page);
  }

  @Post("read")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: NOTIFICATIONS_FEATURE })
  @ApiOperation({
    summary: "Mark one or many of the caller's notifications read",
    operationId: "markNotificationsRead",
  })
  @ApiOkResponse({ type: MarkReadResultDto })
  async markRead(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: MarkReadDto,
  ): Promise<MarkReadResultDto> {
    const result = await this.service.markRead(principal, body.ids);
    return MarkReadResultDto.from(result);
  }

  @Get("preferences")
  @RequireCapability({ feature: NOTIFICATIONS_FEATURE })
  @ApiOperation({
    summary: "Get the caller's channel preferences",
    operationId: "getNotificationPreferences",
  })
  @ApiOkResponse({ type: NotificationPreferenceListDto })
  async getPreferences(
    @CurrentUser() principal: RequestPrincipal,
  ): Promise<NotificationPreferenceListDto> {
    const preferences = await this.service.getPreferences(principal);
    return NotificationPreferenceListDto.from(preferences);
  }

  @Put("preferences")
  @RequireCapability({ feature: NOTIFICATIONS_FEATURE })
  @ApiOperation({
    summary: "Update the caller's channel preferences",
    operationId: "updateNotificationPreferences",
  })
  @ApiOkResponse({ type: NotificationPreferenceListDto })
  async updatePreferences(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: UpdatePreferencesDto,
  ): Promise<NotificationPreferenceListDto> {
    const preferences = await this.service.updatePreferences(principal, body.preferences);
    return NotificationPreferenceListDto.from(preferences);
  }

  @Post("push/subscriptions")
  @RequireCapability({ feature: NOTIFICATIONS_FEATURE })
  @ApiOperation({
    summary: "Register a Web Push endpoint",
    operationId: "registerPushSubscription",
  })
  @ApiOkResponse({ type: PushSubscriptionDto })
  async registerSubscription(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: RegisterPushSubscriptionDto,
  ): Promise<PushSubscriptionDto> {
    const subscription = await this.service.registerSubscription(principal, {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      ...(body.userAgent !== undefined ? { userAgent: body.userAgent } : {}),
    });
    return PushSubscriptionDto.from(subscription);
  }

  @Delete("push/subscriptions/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireCapability({ feature: NOTIFICATIONS_FEATURE })
  @ApiOperation({ summary: "Remove a Web Push endpoint", operationId: "removePushSubscription" })
  async removeSubscription(
    @CurrentUser() principal: RequestPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.removeSubscription(principal, id);
  }
}
