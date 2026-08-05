import { ApiProperty } from "@nestjs/swagger";
import type { MembershipCompany, MeView } from "../../domain/tenancy.types";

/** A company the caller belongs to, with their membership role/status. */
export class MembershipCompanyDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "Acme Gifts" })
  name!: string;

  @ApiProperty({ nullable: true, example: "acme" })
  slug!: string | null;

  @ApiProperty({ example: "owner" })
  role!: string;

  @ApiProperty({ example: "active" })
  status!: string;

  @ApiProperty({ nullable: true, example: "20", description: "WhatsApp dialing prefix." })
  whatsappCountryCode!: string | null;

  static from(company: MembershipCompany): MembershipCompanyDto {
    const dto = new MembershipCompanyDto();
    dto.id = company.id;
    dto.name = company.name;
    dto.slug = company.slug;
    dto.role = company.role;
    dto.status = company.status;
    dto.whatsappCountryCode = company.whatsappCountryCode;
    return dto;
  }
}

/** The caller's profile plus the companies they belong to. */
export class MeDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "founder@acme.test" })
  email!: string;

  @ApiProperty({ nullable: true, example: "Amina Saleh" })
  fullName!: string | null;

  @ApiProperty({ nullable: true, description: "Decrypted for the owner only.", example: "+20…" })
  phone!: string | null;

  @ApiProperty({ description: "Whether TOTP 2FA is enabled." })
  twoFactorEnabled!: boolean;

  @ApiProperty({ nullable: true, format: "uuid", description: "Active tenant from the token." })
  activeCompanyId!: string | null;

  @ApiProperty({ type: [MembershipCompanyDto] })
  companies!: MembershipCompanyDto[];

  static from(view: MeView): MeDto {
    const dto = new MeDto();
    dto.id = view.id;
    dto.email = view.email;
    dto.fullName = view.fullName;
    dto.phone = view.phone;
    dto.twoFactorEnabled = view.twoFactorEnabled;
    dto.activeCompanyId = view.activeCompanyId;
    dto.companies = view.companies.map((c) => MembershipCompanyDto.from(c));
    return dto;
  }
}

/** Envelope for the companies list. */
export class CompanyListDto {
  @ApiProperty({ type: [MembershipCompanyDto] })
  data!: MembershipCompanyDto[];

  static from(companies: readonly MembershipCompany[]): CompanyListDto {
    const dto = new CompanyListDto();
    dto.data = companies.map((c) => MembershipCompanyDto.from(c));
    return dto;
  }
}
