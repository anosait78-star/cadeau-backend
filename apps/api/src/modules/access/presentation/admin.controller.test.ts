import type { KeysetPage } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { AdminService } from "../application/admin.service";
import type { AdminCompanyView } from "../domain/access.types";
import { AdminController } from "./admin.controller";

const PRINCIPAL: RequestPrincipal = { userId: "admin1", sessionId: "s1", companyId: null };

describe("AdminController", () => {
  it("parses limit and maps the companies page", async () => {
    const page: KeysetPage<AdminCompanyView> = {
      data: [
        {
          id: "c1",
          name: "Acme",
          slug: "acme",
          status: "active",
          planCode: "pro",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      page: { limit: 10, nextCursor: "cur", hasMore: true },
    };
    const list = vi.fn().mockResolvedValue(page);
    const service = { listCompanies: list } as unknown as AdminService;

    const dto = await new AdminController(service).listCompanies(PRINCIPAL, "10", "cur0");

    expect(list).toHaveBeenCalledWith(PRINCIPAL, 10, "cur0");
    expect(dto.data[0]).toEqual({
      id: "c1",
      name: "Acme",
      slug: "acme",
      status: "active",
      planCode: "pro",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(dto.page).toEqual({ limit: 10, nextCursor: "cur", hasMore: true });
  });

  it("passes an undefined limit through when not provided", async () => {
    const list = vi.fn().mockResolvedValue({
      data: [],
      page: { limit: 25, nextCursor: null, hasMore: false },
    });
    const service = { listCompanies: list } as unknown as AdminService;
    await new AdminController(service).listCompanies(PRINCIPAL);
    expect(list).toHaveBeenCalledWith(PRINCIPAL, undefined, undefined);
  });

  it("toggles a feature", async () => {
    const toggle = vi.fn().mockResolvedValue({ featureKey: "analytics", enabled: true });
    const service = { toggleFeature: toggle } as unknown as AdminService;
    const out = await new AdminController(service).toggleFeature(PRINCIPAL, "c1", "analytics", {
      enabled: true,
    });
    expect(toggle).toHaveBeenCalledWith(PRINCIPAL, "c1", "analytics", true);
    expect(out).toEqual({ featureKey: "analytics", enabled: true });
  });

  it("sets a subscription", async () => {
    const setSub = vi.fn().mockResolvedValue({ planCode: "pro" });
    const service = { setSubscription: setSub } as unknown as AdminService;
    const out = await new AdminController(service).setSubscription(PRINCIPAL, "c1", {
      planCode: "pro",
    });
    expect(setSub).toHaveBeenCalledWith(PRINCIPAL, "c1", "pro");
    expect(out).toEqual({ planCode: "pro" });
  });
});
