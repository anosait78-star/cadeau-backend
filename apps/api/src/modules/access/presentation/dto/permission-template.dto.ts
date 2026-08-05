import { ApiProperty } from "@nestjs/swagger";
import type { PermissionTemplateView } from "../../domain/access.types";

/** A permission template (role preset) with its granted permission keys. */
export class PermissionTemplateDto {
  @ApiProperty({ example: "store_manager" })
  key!: string;

  @ApiProperty({ example: "Store Manager" })
  name!: string;

  @ApiProperty({ nullable: true, example: "Runs day-to-day operations across the store." })
  description!: string | null;

  @ApiProperty({ type: [String], example: ["orders.read", "orders.manage"] })
  permissions!: string[];

  static from(view: PermissionTemplateView): PermissionTemplateDto {
    const dto = new PermissionTemplateDto();
    dto.key = view.key;
    dto.name = view.name;
    dto.description = view.description;
    dto.permissions = [...view.permissions];
    return dto;
  }
}

/** Envelope for the permission-templates list. */
export class PermissionTemplateListDto {
  @ApiProperty({ type: [PermissionTemplateDto] })
  data!: PermissionTemplateDto[];

  static from(views: readonly PermissionTemplateView[]): PermissionTemplateListDto {
    const dto = new PermissionTemplateListDto();
    dto.data = views.map((v) => PermissionTemplateDto.from(v));
    return dto;
  }
}
