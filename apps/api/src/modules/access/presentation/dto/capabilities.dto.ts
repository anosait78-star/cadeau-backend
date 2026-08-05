import { ApiProperty } from "@nestjs/swagger";
import type { CapabilitiesView } from "../../domain/access.types";

/** The caller's resolved capabilities and platform/tenant context. */
export class CapabilitiesDto {
  @ApiProperty({ type: [String], description: "Feature keys enabled for the active company." })
  features!: string[];

  @ApiProperty({ type: [String], description: "Permission keys the caller effectively holds." })
  permissions!: string[];

  @ApiProperty({ description: "Whether the caller holds the platform Super-Admin grant." })
  isSuperAdmin!: boolean;

  @ApiProperty({ nullable: true, format: "uuid", description: "Active tenant from the token." })
  activeCompanyId!: string | null;

  static from(view: CapabilitiesView): CapabilitiesDto {
    const dto = new CapabilitiesDto();
    dto.features = [...view.features];
    dto.permissions = [...view.permissions];
    dto.isSuperAdmin = view.isSuperAdmin;
    dto.activeCompanyId = view.activeCompanyId;
    return dto;
  }
}
