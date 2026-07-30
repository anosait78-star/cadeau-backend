import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type {
  AcceptInvitationResult,
  CreateCompanyResult,
  CreatedInvitation,
  TenancyService,
} from "../application/tenancy.service";
import type { MembershipCompany, MeView } from "../domain/tenancy.types";
import type { TokenPair } from "../../../shared/contracts/token-pair";
import { TenancyController } from "./tenancy.controller";

const PRINCIPAL: RequestPrincipal = {
  userId: randomUUID(),
  sessionId: randomUUID(),
  companyId: randomUUID(),
};
const TOKENS: TokenPair = { accessToken: "a", refreshToken: "r", expiresInSeconds: 300 };

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
      { id: randomUUID(), name: "Acme", slug: "acme", role: "owner", status: "active" },
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
      },
      tokens: TOKENS,
    };
    const createCompany = vi.fn().mockResolvedValue(result);
    const controller = make({ createCompany });
    const dto = await controller.createCompany(PRINCIPAL, { name: "New Co", slug: "new-co" });
    expect(createCompany).toHaveBeenCalledWith(PRINCIPAL, { name: "New Co", slug: "new-co" });
    expect(dto.company.name).toBe("New Co");
    expect(dto.tokens.accessToken).toBe("a");
  });

  it("POST /companies defaults a missing slug to null", async () => {
    const createCompany = vi.fn().mockResolvedValue({
      company: { id: randomUUID(), name: "X", slug: null, status: "active", createdAt: new Date() },
      tokens: TOKENS,
    } satisfies CreateCompanyResult);
    const controller = make({ createCompany });
    await controller.createCompany(PRINCIPAL, { name: "X" });
    expect(createCompany).toHaveBeenCalledWith(PRINCIPAL, { name: "X", slug: null });
  });

  it("POST /companies/:id/switch returns tokens", async () => {
    const companyId = randomUUID();
    const switchCompany = vi.fn().mockResolvedValue(TOKENS);
    const controller = make({ switchCompany });
    const dto = await controller.switchCompany(PRINCIPAL, companyId);
    expect(switchCompany).toHaveBeenCalledWith(PRINCIPAL, companyId);
    expect(dto.refreshToken).toBe("r");
  });

  it("POST invitations returns the created invite with its one-time code", async () => {
    const companyId = randomUUID();
    const created: CreatedInvitation = {
      invitation: {
        id: randomUUID(),
        companyId,
        email: "t@test.dev",
        role: "member",
        status: "pending",
        expiresAt: new Date(),
        createdAt: new Date(),
      },
      code: "secret-code",
    };
    const createInvitation = vi.fn().mockResolvedValue(created);
    const controller = make({ createInvitation });
    const dto = await controller.createInvitation(PRINCIPAL, companyId, { email: "t@test.dev" });
    expect(createInvitation).toHaveBeenCalledWith(PRINCIPAL, companyId, {
      email: "t@test.dev",
      role: "member",
    });
    expect(dto.code).toBe("secret-code");
  });

  it("DELETE invitations delegates the revoke", async () => {
    const companyId = randomUUID();
    const invitationId = randomUUID();
    const revokeInvitation = vi.fn().mockResolvedValue(undefined);
    const controller = make({ revokeInvitation });
    await controller.revokeInvitation(PRINCIPAL, companyId, invitationId);
    expect(revokeInvitation).toHaveBeenCalledWith(PRINCIPAL, companyId, invitationId);
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
});
