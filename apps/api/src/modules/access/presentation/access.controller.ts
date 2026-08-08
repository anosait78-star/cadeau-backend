import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../../shared/auth/current-user.decorator";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { JwtAuthGuard } from "../../../shared/auth/jwt-auth.guard";
import { AccessGuard } from "../../../shared/access/access.guard";
import { RequireCapability } from "../../../shared/access/require-capability.decorator";
import { AccessService } from "../application/access.service";
import { AvailablePermissionListDto } from "./dto/available-permission.dto";
import { CapabilitiesDto } from "./dto/capabilities.dto";
import { FeatureListDto } from "./dto/feature.dto";
import { PermissionTemplateListDto } from "./dto/permission-template.dto";
import { AssignMemberPermissionsDto, MemberPermissionsDto } from "./dto/member-permissions.dto";

/**
 * Access endpoints under `/v1/access` (contract: docs/api/access.md). All require
 * a valid access token; the management routes are additionally gated by the
 * three-layer {@link AccessGuard}. The active tenant is taken from the token,
 * never the payload (ADR-003).
 */
@ApiTags("access")
@Controller("access")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get("capabilities")
  @ApiOperation({ summary: "The caller's effective capabilities", operationId: "getCapabilities" })
  @ApiOkResponse({ type: CapabilitiesDto })
  async getCapabilities(@CurrentUser() principal: RequestPrincipal): Promise<CapabilitiesDto> {
    return CapabilitiesDto.from(await this.access.getCapabilities(principal));
  }

  @Get("features")
  @RequireCapability({ permission: "access.read" })
  @ApiOperation({ summary: "Features available to the company", operationId: "listFeatures" })
  @ApiOkResponse({ type: FeatureListDto })
  async listFeatures(@CurrentUser() principal: RequestPrincipal): Promise<FeatureListDto> {
    return FeatureListDto.from(await this.access.listFeatures(principal));
  }

  @Get("permission-templates")
  @RequireCapability({ permission: "access.read" })
  @ApiOperation({ summary: "The permission templates", operationId: "listPermissionTemplates" })
  @ApiOkResponse({ type: PermissionTemplateListDto })
  async listPermissionTemplates(): Promise<PermissionTemplateListDto> {
    return PermissionTemplateListDto.from(await this.access.listPermissionTemplates());
  }

  @Get("available-permissions")
  @RequireCapability({ permission: "access.read" })
  @ApiOperation({
    summary: "Permissions available to the active company (custom-role picker)",
    operationId: "listAvailablePermissions",
  })
  @ApiOkResponse({ type: AvailablePermissionListDto })
  async listAvailablePermissions(
    @CurrentUser() principal: RequestPrincipal,
  ): Promise<AvailablePermissionListDto> {
    return AvailablePermissionListDto.from(await this.access.listAvailablePermissions(principal));
  }

  @Put("members/:memberId/permissions")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ permission: "access.manage" })
  @ApiOperation({
    summary: "Assign a template and/or permission overrides to a member",
    operationId: "assignMemberPermissions",
  })
  @ApiOkResponse({ type: MemberPermissionsDto })
  async assignMemberPermissions(
    @CurrentUser() principal: RequestPrincipal,
    @Param("memberId", ParseUUIDPipe) memberId: string,
    @Body() dto: AssignMemberPermissionsDto,
  ): Promise<MemberPermissionsDto> {
    const snapshot = await this.access.assignMemberPermissions(principal, memberId, {
      ...(dto.templateKey !== undefined ? { templateKey: dto.templateKey } : {}),
      ...(dto.permissions !== undefined
        ? { overrides: dto.permissions.map((p) => ({ key: p.key, granted: p.granted })) }
        : {}),
    });
    return MemberPermissionsDto.from(snapshot);
  }
}
