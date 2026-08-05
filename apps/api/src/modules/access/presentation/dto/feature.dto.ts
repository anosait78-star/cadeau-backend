import { ApiProperty } from "@nestjs/swagger";
import type { FeatureView } from "../../domain/access.types";

/** A feature in the catalog, annotated with whether it is enabled for the company. */
export class FeatureDto {
  @ApiProperty({ example: "orders" })
  key!: string;

  @ApiProperty({ example: "Orders" })
  name!: string;

  @ApiProperty({ example: "operations" })
  category!: string;

  @ApiProperty({ description: "Whether the feature is effective for the active company." })
  enabled!: boolean;

  static from(view: FeatureView): FeatureDto {
    const dto = new FeatureDto();
    dto.key = view.key;
    dto.name = view.name;
    dto.category = view.category;
    dto.enabled = view.enabled;
    return dto;
  }
}

/** Envelope for the features list. */
export class FeatureListDto {
  @ApiProperty({ type: [FeatureDto] })
  data!: FeatureDto[];

  static from(views: readonly FeatureView[]): FeatureListDto {
    const dto = new FeatureListDto();
    dto.data = views.map((v) => FeatureDto.from(v));
    return dto;
  }
}
