import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { StorefrontConnectionsService } from "../application/storefront-connections.service";
import { StorefrontIngestionService } from "../application/storefront-ingestion.service";
import {
  ConnectionListDto,
  CreateConnectionDto,
  IngestResultDto,
  StorefrontConnectionDto,
  StorefrontConnectionWithKeyDto,
  UpdateConnectionDto,
  WebhookEventListDto,
} from "./dto/storefront.dto";
import { StorefrontEventsQueryDto } from "./dto/storefront-events-query.dto";
import {
  STOREFRONT_WEBHOOK_INBOX,
  type StorefrontWebhookInboxPort,
} from "../domain/storefront-webhook-inbox.port";
import { AppErrors } from "../../../shared/errors/app-exception";

/** The feature key this module is gated under (access catalog). */
const STOREFRONT_FEATURE = "storefront_integration";
const MANAGE = "integrations.manage";

/**
 * Storefront-connection management under `/v1/integrations/storefront/connections`
 * (contract: docs/api/storefront.md). JWT + three-layer `@RequireCapability`
 * (D1/D2: connections, not the company, own the API key — one label per
 * connection, independently mintable/rotatable/revocable). The ingestion
 * routes are a separate controller, gated by {@link StorefrontApiKeyGuard}
 * instead (no JWT — storefront-integration §D3).
 */
@ApiTags("integrations-storefront")
@Controller("integrations/storefront/connections")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class StorefrontConnectionsController {
  constructor(
    private readonly service: StorefrontConnectionsService,
    private readonly ingestion: StorefrontIngestionService,
    @Inject(STOREFRONT_WEBHOOK_INBOX) private readonly inbox: StorefrontWebhookInboxPort,
  ) {}

  @Get()
  @RequireCapability({ feature: STOREFRONT_FEATURE, permission: MANAGE })
  @ApiOperation({
    summary: "List the company's storefront connections",
    operationId: "listStorefrontConnections",
  })
  @ApiOkResponse({ type: ConnectionListDto })
  async list(
    @CurrentUser() principal: RequestPrincipal,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ): Promise<ConnectionListDto> {
    const page = await this.service.list(
      principal,
      limit === undefined ? undefined : Number(limit),
      cursor,
    );
    return ConnectionListDto.from(page);
  }

  @Post()
  @RequireCapability({ feature: STOREFRONT_FEATURE, permission: MANAGE })
  @ApiOperation({
    summary: "Create a storefront connection (returns the plaintext API key once)",
    operationId: "createStorefrontConnection",
  })
  @ApiCreatedResponse({ type: StorefrontConnectionWithKeyDto })
  async create(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: CreateConnectionDto,
  ): Promise<StorefrontConnectionWithKeyDto> {
    const result = await this.service.create(principal, {
      label: body.label,
      ...(body.platform === undefined ? {} : { platform: body.platform }),
      ...(body.defaultWarehouseId === undefined
        ? {}
        : { defaultWarehouseId: body.defaultWarehouseId }),
    });
    return StorefrontConnectionWithKeyDto.fromSecret(result);
  }

  @Get(":connectionId")
  @RequireCapability({ feature: STOREFRONT_FEATURE, permission: MANAGE })
  @ApiOperation({ summary: "Connection detail", operationId: "getStorefrontConnection" })
  @ApiOkResponse({ type: StorefrontConnectionDto })
  async getOne(
    @CurrentUser() principal: RequestPrincipal,
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
  ): Promise<StorefrontConnectionDto> {
    return StorefrontConnectionDto.from(await this.service.getOne(principal, connectionId));
  }

  @Patch(":connectionId")
  @RequireCapability({ feature: STOREFRONT_FEATURE, permission: MANAGE })
  @ApiOperation({
    summary: "Update label / defaultWarehouseId / status",
    operationId: "updateStorefrontConnection",
  })
  @ApiOkResponse({ type: StorefrontConnectionDto })
  async update(
    @CurrentUser() principal: RequestPrincipal,
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
    @Body() body: UpdateConnectionDto,
  ): Promise<StorefrontConnectionDto> {
    return StorefrontConnectionDto.from(
      await this.service.update(principal, connectionId, {
        ...(body.label === undefined ? {} : { label: body.label }),
        ...(body.defaultWarehouseId === undefined
          ? {}
          : { defaultWarehouseId: body.defaultWarehouseId }),
        ...(body.status === undefined ? {} : { status: body.status }),
      }),
    );
  }

  @Post(":connectionId/rotate-key")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: STOREFRONT_FEATURE, permission: MANAGE })
  @ApiOperation({
    summary: "Issue a new key for this connection only (returns it once)",
    operationId: "rotateStorefrontConnectionKey",
  })
  @ApiOkResponse({ type: StorefrontConnectionWithKeyDto })
  async rotateKey(
    @CurrentUser() principal: RequestPrincipal,
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
  ): Promise<StorefrontConnectionWithKeyDto> {
    return StorefrontConnectionWithKeyDto.fromSecret(
      await this.service.rotateKey(principal, connectionId),
    );
  }

  @Post(":connectionId/revoke")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: STOREFRONT_FEATURE, permission: MANAGE })
  @ApiOperation({
    summary: "Revoke a connection (terminal)",
    operationId: "revokeStorefrontConnection",
  })
  @ApiOkResponse({ type: StorefrontConnectionDto })
  async revoke(
    @CurrentUser() principal: RequestPrincipal,
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
  ): Promise<StorefrontConnectionDto> {
    return StorefrontConnectionDto.from(await this.service.revoke(principal, connectionId));
  }

  @Get(":connectionId/events")
  @RequireCapability({ feature: STOREFRONT_FEATURE, permission: MANAGE })
  @ApiOperation({
    summary: "Recent webhook events for this connection",
    operationId: "listStorefrontEvents",
  })
  @ApiOkResponse({ type: WebhookEventListDto })
  async listEvents(
    @CurrentUser() principal: RequestPrincipal,
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
    @Query() query: StorefrontEventsQueryDto,
  ): Promise<WebhookEventListDto> {
    const companyId = principal.companyId;
    if (companyId === null) throw AppErrors.forbidden("Select an active company first.");
    const page = await this.inbox.list(
      companyId,
      connectionId,
      query.limit === undefined ? 25 : Number(query.limit),
      query.cursor,
      query.status,
      query.eventType,
    );
    return WebhookEventListDto.from(page);
  }

  @Post(":connectionId/events/:eventId/reprocess")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: STOREFRONT_FEATURE, permission: MANAGE })
  @ApiOperation({
    summary: "Manually re-run a failed event",
    operationId: "reprocessStorefrontEvent",
  })
  @ApiOkResponse({ type: IngestResultDto })
  async reprocess(
    @CurrentUser() principal: RequestPrincipal,
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
    @Param("eventId", ParseUUIDPipe) eventId: string,
  ): Promise<IngestResultDto> {
    return IngestResultDto.from(
      await this.ingestion.reprocessEvent(principal, connectionId, eventId),
    );
  }
}
