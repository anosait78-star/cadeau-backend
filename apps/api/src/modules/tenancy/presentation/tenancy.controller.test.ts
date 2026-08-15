import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type {
  AcceptInvitationResult,
  AcceptWarehouseJoinCodeResult,
  CreateCompanyResult,
  CreatedInvitation,
  TenancyService,
} from "../application/tenancy.service";
import type { CompanyRecord, MembershipCompany, MeView } from "../domain/tenancy.types";
import type { TokenPair } from "../../../shared/contracts/token-pair";
import { TenancyController } from "./tenancy.controller";

const PRINCIPAL: RequestPrincipal = {
  userId: randomUUID(),
  sessionId: randomUUID(),
  companyId: randomUUID(),
};
const TOKENS: TokenPair = { accessToken: "a", refreshToken: "r", expiresInSeconds: 300 };

const ONBOARDING_DTO_FIELDS = {
  phone: "+201234567890",
  monthlyOrdersRange: "100_500" as const,
};
const ONBOARDING_RECORD_FIELDS = {
  phone: "+201234567890",
  monthlyOrdersRange: "100_500",
  country: null,
  facebookHandle: null,
  instagramHandle: null,
  websiteUrl: null,
  shippingCarrier: null,
  whatsappCountryCode: null,
};

function make(overrides: Partial<TenancyService>): TenancyController {
  return new TenancyController(overrides as unknown as TenancyService);
}

describe("TenancyController", () => {
  it("GET /me returns the assembled profile view", async () => {
    const view: MeView = {
      id: PRINCIPAL.userId,
      email: "me@test.dev",
      fullName: "Me",
      phone: null,
      twoFactorEnabled: true,
      activeCompanyId: PRINCIPAL.companyId,
      companies: [],
    };
    const controller = make({ getMe: vi.fn().mockResolvedValue(view) });
    const dto = await controller.getMe(PRINCIPAL);
    expect(dto).toMatchObject({ email: "me@test.dev", twoFactorEnabled: true, companies: [] });
  });

  it("GET /companies wraps the list in an envelope", async () => {
    const companies: MembershipCompany[] = [
      {
        id: randomUUID(),
        name: "Acme",
        slug: "acme",
        role: "owner",
        status: "active",
        whatsappCountryCode: null,
      },
    ];
    const controller = make({ listCompanies: vi.fn().mockResolvedValue(companies) });
    const dto = await controller.listCompanies(PRINCIPAL);
    expect(dto.data).toHaveLength(1);
    expect(dto.data[0]).toMatchObject({ name: "Acme", role: "owner" });
  });

  it("POST /companies returns the company plus re-issued tokens", async () => {
    const result: CreateCompanyResult = {
      company: {
        id: randomUUID(),
        name: "New Co",
        slug: "new-co",
        status: "active",
        createdAt: new Date(),
        ...ONBOARDING_RECORD_FIELDS,
      },
      tokens: TOKENS,
    };
    const createCompany = vi.fn().mockResolvedValue(result);
    const controller = make({ createCompany });
    const dto = await controller.createCompany(PRINCIPAL, {
      name: "New Co",
      slug: "new-co",
      ...ONBOARDING_DTO_FIELDS,
    });
    expect(createCompany).toHaveBeenCalledWith(PRINCIPAL, {
      name: "New Co",
      slug: "new-co",
      phone: ONBOARDING_DTO_FIELDS.phone,
      monthlyOrdersRange: ONBOARDING_DTO_FIELDS.monthlyOrdersRange,
      country: null,
      facebookHandle: null,
      instagramHandle: null,
      websiteUrl: null,
      shippingCarrier: null,
    });
    expect(dto.company.name).toBe("New Co");
    expect(dto.tokens.accessToken).toBe("a");
  });

  it("POST /companies defaults a missing slug to null", async () => {
    const createCompany = vi.fn().mockResolvedValue({
      company: {
        id: randomUUID(),
        name: "X",
        slug: null,
        status: "active",
        createdAt: new Date(),
        ...ONBOARDING_RECORD_FIELDS,
      },
      tokens: TOKENS,
    } satisfies CreateCompanyResult);
    const controller = make({ createCompany });
    await controller.createCompany(PRINCIPAL, { name: "X", ...ONBOARDING_DTO_FIELDS });
    expect(createCompany).toHaveBeenCalledWith(PRINCIPAL, {
      name: "X",
      slug: null,
      phone: ONBOARDING_DTO_FIELDS.phone,
      monthlyOrdersRange: ONBOARDING_DTO_FIELDS.monthlyOrdersRange,
      country: null,
      facebookHandle: null,
      instagramHandle: null,
      websiteUrl: null,
      shippingCarrier: null,
    });
  });

  it("POST /companies/:id/switch returns tokens", async () => {
    const companyId = randomUUID();
    const switchCompany = vi.fn().mockResolvedValue(TOKENS);
    const controller = make({ switchCompany });
    const dto = await controller.switchCompany(PRINCIPAL, companyId);
    expect(switchCompany).toHaveBeenCalledWith(PRINCIPAL, companyId);
    expect(dto.refreshToken).toBe("r");
  });

  it("PATCH whatsapp-settings delegates and returns the updated company", async () => {
    const companyId = randomUUID();
    const company: CompanyRecord = {
      id: companyId,
      name: "Acme",
      slug: "acme",
      status: "active",
      ...ONBOARDING_RECORD_FIELDS,
      whatsappCountryCode: "20",
      createdAt: new Date(),
    };
    const updateWhatsappSettings = vi.fn().mockResolvedValue(company);
    const controller = make({ updateWhatsappSettings });
    const dto = await controller.updateWhatsappSettings(PRINCIPAL, companyId, {
      countryCode: "20",
    });
    expect(updateWhatsappSettings).toHaveBeenCalledWith(PRINCIPAL, companyId, "20");
    expect(dto.whatsappCountryCode).toBe("20");
  });

  it("POST invitations returns the created invite with its one-time code", async () => {
    const companyId = randomUUID();
    const created: CreatedInvitation = {
      invitation: {
        id: randomUUID(),
        companyId,
        email: "t@test.dev",
        role: "store_manager",
        customPermissionKeys: [],
        status: "pending",
        expiresAt: new Date(),
        createdAt: new Date(),
      },
      code: "secret-code",
    };
    const createInvitation = vi.fn().mockResolvedValue(created);
    const controller = make({ createInvitation });
    const dto = await controller.createInvitation(PRINCIPAL, companyId, {
      email: "t@test.dev",
      role: "store_manager",
    });
    expect(createInvitation).toHaveBeenCalledWith(PRINCIPAL, companyId, {
      email: "t@test.dev",
      role: "store_manager",
      permissionKeys: undefined,
    });
    expect(dto.code).toBe("secret-code");
    expect(dto.role).toBe("store_manager");
  });

  it("POST invitations passes permissionKeys through for a custom role", async () => {
    const companyId = randomUUID();
    const created: CreatedInvitation = {
      invitation: {
        id: randomUUID(),
        companyId,
        email: "t@test.dev",
        role: "custom",
        customPermissionKeys: ["orders.read"],
        status: "pending",
        expiresAt: new Date(),
        createdAt: new Date(),
      },
      code: "secret-code",
    };
    const createInvitation = vi.fn().mockResolvedValue(created);
    const controller = make({ createInvitation });
    const dto = await controller.createInvitation(PRINCIPAL, companyId, {
      email: "t@test.dev",
      role: "custom",
      permissionKeys: ["orders.read"],
    });
    expect(createInvitation).toHaveBeenCalledWith(PRINCIPAL, companyId, {
      email: "t@test.dev",
      role: "custom",
      permissionKeys: ["orders.read"],
    });
    expect(dto.permissionKeys).toEqual(["orders.read"]);
  });

  it("DELETE invitations delegates the revoke", async () => {
    const companyId = randomUUID();
    const invitationId = randomUUID();
    const revokeInvitation = vi.fn().mockResolvedValue(undefined);
    const controller = make({ revokeInvitation });
    await controller.revokeInvitation(PRINCIPAL, companyId, invitationId);
    expect(revokeInvitation).toHaveBeenCalledWith(PRINCIPAL, companyId, invitationId);
  });

  it("GET invitations delegates and lists them", async () => {
    const companyId = randomUUID();
    const listInvitations = vi.fn().mockResolvedValue([
      {
        id: randomUUID(),
        companyId,
        email: "t@test.dev",
        role: "custom",
        customPermissionKeys: ["orders.read"],
        status: "pending",
        expiresAt: new Date(),
        createdAt: new Date(),
      },
    ]);
    const controller = make({ listInvitations });
    const dto = await controller.listInvitations(PRINCIPAL, companyId);
    expect(listInvitations).toHaveBeenCalledWith(PRINCIPAL, companyId);
    expect(dto.data).toHaveLength(1);
    expect(dto.data[0]).toMatchObject({ role: "custom", permissionKeys: ["orders.read"] });
  });

  it("GET members delegates and lists them", async () => {
    const companyId = randomUUID();
    const listMembers = vi.fn().mockResolvedValue([
      {
        id: randomUUID(),
        userId: randomUUID(),
        name: "Jane",
        email: "jane@test.dev",
        role: "owner",
        status: "active",
        joinedAt: new Date(),
      },
    ]);
    const controller = make({ listMembers });
    const dto = await controller.listMembers(PRINCIPAL, companyId);
    expect(listMembers).toHaveBeenCalledWith(PRINCIPAL, companyId);
    expect(dto.data).toHaveLength(1);
    expect(dto.data[0]).toMatchObject({ name: "Jane", email: "jane@test.dev", role: "owner" });
  });

  it("DELETE members delegates the removal", async () => {
    const companyId = randomUUID();
    const memberId = randomUUID();
    const removeMember = vi.fn().mockResolvedValue(undefined);
    const controller = make({ removeMember });
    await controller.removeMember(PRINCIPAL, companyId, memberId);
    expect(removeMember).toHaveBeenCalledWith(PRINCIPAL, companyId, memberId);
  });

  it("POST invitations/accept returns the join outcome", async () => {
    const result: AcceptInvitationResult = {
      companyId: randomUUID(),
      role: "member",
      alreadyMember: false,
    };
    const acceptInvitation = vi.fn().mockResolvedValue(result);
    const controller = make({ acceptInvitation });
    const dto = await controller.acceptInvitation(PRINCIPAL, { code: "secret-code" });
    expect(acceptInvitation).toHaveBeenCalledWith(PRINCIPAL, "secret-code");
    expect(dto).toMatchObject({ role: "member", alreadyMember: false });
  });

  it("POST warehouse-join-codes/accept returns the vendor join outcome (Vendor Accounts, Phase 1)", async () => {
    const result: AcceptWarehouseJoinCodeResult = {
      companyId: randomUUID(),
      role: "vendor",
      warehouseId: randomUUID(),
      alreadyMember: false,
    };
    const joinWarehouseByCode = vi.fn().mockResolvedValue(result);
    const controller = make({ joinWarehouseByCode });
    const dto = await controller.acceptWarehouseJoinCode(PRINCIPAL, { code: "wh-code" });
    expect(joinWarehouseByCode).toHaveBeenCalledWith(PRINCIPAL, "wh-code");
    expect(dto).toMatchObject({
      role: "vendor",
      warehouseId: result.warehouseId,
      alreadyMember: false,
    });
  });
});
