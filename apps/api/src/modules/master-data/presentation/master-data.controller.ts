import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser } from "../../../shared/auth/current-user.decorator";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { JwtAuthGuard } from "../../../shared/auth/jwt-auth.guard";
import { AccessGuard } from "../../../shared/access/access.guard";
import { RequireCapability } from "../../../shared/access/require-capability.decorator";
import type { RawListQuery } from "../domain/list-query";
import { RESOURCES } from "../domain/resource-registry";
import { MasterDataService } from "../application/master-data.service";
import { MasterDataItemDto, MasterDataListDto, ResourceListDto } from "./dto/master-data.dto";

/** Query keys the engine interprets itself; anything else is a resource filter. */
const RESERVED_QUERY_KEYS = new Set(["limit", "cursor", "sort", "q", "active"]);

const MASTER_DATA_FEATURE = "master-data";

/**
 * The master-data engine endpoints under `/v1/master-data` (contract:
 * docs/api/master-data.md). One generic controller drives every resource in the
 * registry. All routes require a valid access token and the three-layer
 * {@link AccessGuard}: reads need `master-data.read`, writes `master-data.manage`,
 * both under the `master-data` feature. The tenant comes from the token, never
 * the payload (ADR-003). System reference resources reject writes (`403`).
 */
@ApiTags("master-data")
@Controller("master-data")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class MasterDataController {
  constructor(private readonly service: MasterDataService) {}

  @Get()
  @RequireCapability({ feature: MASTER_DATA_FEATURE, permission: "master-data.read" })
  @ApiOperation({
    summary: "List the master-data resources",
    operationId: "listMasterDataResources",
  })
  @ApiOkResponse({ type: ResourceListDto })
  listResources(): ResourceListDto {
    return ResourceListDto.from(RESOURCES);
  }

  @Get(":resource")
  @RequireCapability({ feature: MASTER_DATA_FEATURE, permission: "master-data.read" })
  @ApiOperation({ summary: "List a resource (keyset, filtered)", operationId: "listMasterData" })
  @ApiOkResponse({ type: MasterDataListDto })
  async list(
    @CurrentUser() principal: RequestPrincipal,
    @Param("resource") resource: string,
    @Query() rawQuery: Record<string, string>,
  ): Promise<MasterDataListDto> {
    const query = this.toListQuery(rawQuery);
    return MasterDataListDto.from(await this.service.list(principal, resource, query));
  }

  @Get(":resource/:id")
  @RequireCapability({ feature: MASTER_DATA_FEATURE, permission: "master-data.read" })
  @ApiOperation({ summary: "Read one resource row", operationId: "getMasterData" })
  @ApiOkResponse({ type: MasterDataItemDto })
  async getOne(
    @CurrentUser() principal: RequestPrincipal,
    @Param("resource") resource: string,
    @Param("id") id: string,
  ): Promise<MasterDataItemDto> {
    return (await this.service.getOne(principal, resource, id)) as MasterDataItemDto;
  }

  @Post(":resource")
  @RequireCapability({ feature: MASTER_DATA_FEATURE, permission: "master-data.manage" })
  @ApiOperation({ summary: "Create a resource row", operationId: "createMasterData" })
  @ApiBody({ schema: { type: "object", additionalProperties: true } })
  @ApiOkResponse({ type: MasterDataItemDto })
  async create(
    @CurrentUser() principal: RequestPrincipal,
    @Param("resource") resource: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MasterDataItemDto> {
    const row = await this.service.create(principal, resource, body);
    res.status(HttpStatus.CREATED);
    res.setHeader("Location", `/v1/master-data/${resource}/${row.id}`);
    return row as MasterDataItemDto;
  }

  @Patch(":resource/:id")
  @RequireCapability({ feature: MASTER_DATA_FEATURE, permission: "master-data.manage" })
  @ApiOperation({ summary: "Update a resource row", operationId: "updateMasterData" })
  @ApiBody({ schema: { type: "object", additionalProperties: true } })
  @ApiOkResponse({ type: MasterDataItemDto })
  async update(
    @CurrentUser() principal: RequestPrincipal,
    @Param("resource") resource: string,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<MasterDataItemDto> {
    return (await this.service.update(principal, resource, id, body)) as MasterDataItemDto;
  }

  @Delete(":resource/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireCapability({ feature: MASTER_DATA_FEATURE, permission: "master-data.manage" })
  @ApiOperation({
    summary: "Deactivate a resource row (soft-delete)",
    operationId: "deleteMasterData",
  })
  async remove(
    @CurrentUser() principal: RequestPrincipal,
    @Param("resource") resource: string,
    @Param("id") id: string,
  ): Promise<void> {
    await this.service.deactivate(principal, resource, id);
  }

  /** Split reserved pagination/sort/search params from resource-specific filters. */
  private toListQuery(raw: Record<string, string>): RawListQuery {
    const filters: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!RESERVED_QUERY_KEYS.has(key)) filters[key] = value;
    }
    return {
      ...(raw["limit"] !== undefined ? { limit: raw["limit"] } : {}),
      ...(raw["cursor"] !== undefined ? { cursor: raw["cursor"] } : {}),
      ...(raw["sort"] !== undefined ? { sort: raw["sort"] } : {}),
      ...(raw["q"] !== undefined ? { q: raw["q"] } : {}),
      ...(raw["active"] !== undefined ? { active: raw["active"] } : {}),
      filters,
    };
  }
}
