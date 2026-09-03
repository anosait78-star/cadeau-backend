import { ApiProperty } from "@nestjs/swagger";
import type { AvailablePermissionView } from "../../domain/access.types";

/** One catalog permission plus whether the caller's company can grant it (custom-role picker). */
export class AvailablePermissionDto {
  @ApiProperty({ example: "orders.manage" })
  key!: string;

  @ApiProperty({ nullable: true, example: "Create, update, and delete orders" })
  description!: string | null;

  @ApiProperty({ nullable: true, example: "orders", description: "null for core permissions." })
  featureKey!: string | null;

  @ApiProperty({
    example: true,
    description: "False when the company's plan/features do not currently make this grantable.",
  })
  available!: boolean;

  static from(view: AvailablePermissionView): AvailablePermissionDto {
    const dto = new AvailablePermissionDto();
    dto.key = view.key;
    dto.description = view.description;
    dto.featureKey = view.featureKey;
    dto.available = view.available;
    return dto;
  }
}

/** Envelope for the available-permissions list. */
export class AvailablePermissionListDto {
  @ApiProperty({ type: [AvailablePermissionDto] })
  data!: AvailablePermissionDto[];

  static from(views: readonly AvailablePermissionView[]): AvailablePermissionListDto {
    const dto = new AvailablePermissionListDto();
    dto.data = views.map((v) => AvailablePermissionDto.from(v));
    return dto;
  }
}
