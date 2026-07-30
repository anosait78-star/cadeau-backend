import type { KeysetPage } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppException } from "../../../shared/errors/app-exception";
import { CapabilityCache } from "../../../shared/access/capability-cache";
import type { EventBusPort } from "../../../shared/events/event-bus.port";
import type { AccessAuditPort } from "../domain/access-audit.port";
import type { AccessManagementRepositoryPort } from "../domain/access-management.port";
import { InvalidCursorInputError } from "../domain/access.errors";
import type { AdminCompanyView } from "../domain/access.types";
import { AdminService } from "./admin.service";

const PRINCIPAL: RequestPrincipal = { userId: "admin1", sessionId: "s1", companyId: null };

function build(repo: Partial<AccessManagementRepositoryPort>): {
  service: AdminService;
  audit: AccessAuditPort;
  events: EventBusPort;
  cache: CapabilityCache;
} {
  const full = {
    listAllCompanies: vi.fn(),
    featureExists: vi.fn().mockResolvedValue(true),
    findPlanByCode: vi.fn().mockResolvedValue({ id: "p1", code: "pro" }),
    setCompanyFeatureFlag: vi.fn().mockResolvedValue(undefined),
    setSubscription: vi.fn().mockResolvedValue(undefined),
    ...repo,
  } as unknown as AccessManagementRepositoryPort;
  const audit: AccessAuditPort = { record: vi.fn().mockResolvedValue(undefined) };
  const events: EventBusPort = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
  };
  const cache = new CapabilityCache({ now: () => 0 });
  const service = new AdminService(full, audit, events, { now: () => 42 }, cache);
  return { service, audit, events, cache };
}

describe("AdminService.listCompanies", () => {
  it("delegates to the repository and returns its page", async () => {
    const page: KeysetPage<AdminCompanyView> = {
      data: [],
      page: { limit: 25, nextCursor: null, hasMore: false },
    };
    const { service } = build({ listAllCompanies: vi.fn().mockResolvedValue(page) });
    expect(await service.listCompanies(PRINCIPAL, undefined, undefined)).toBe(page);
  });

  it("maps a bad cursor to a 400", async () => {
    const { service } = build({
      listAllCompanies: vi.fn().mockRejectedValue(new InvalidCursorInputError()),
    });
    await expect(service.listCompanies(PRINCIPAL, undefined, "junk")).rejects.toBeInstanceOf(
      AppException,
    );
  });
});

describe("AdminService.toggleFeature", () => {
  it("404s for an unknown feature", async () => {
    const { service } = build({ featureExists: vi.fn().mockResolvedValue(false) });
    await expect(service.toggleFeature(PRINCIPAL, "c1", "nope", true)).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it("sets the flag, audits, and invalidates the company cache", async () => {
    const setFlag = vi.fn().mockResolvedValue(undefined);
    const { service, audit, events, cache } = build({ setCompanyFeatureFlag: setFlag });
    const invalidate = vi.spyOn(cache, "invalidateCompany");

    const out = await service.toggleFeature(PRINCIPAL, "c1", "analytics", false);

    expect(out).toEqual({ featureKey: "analytics", enabled: false });
    expect(setFlag).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "c1", featureKey: "analytics", enabled: false }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "access.feature_toggled" }),
    );
    expect(invalidate).toHaveBeenCalledWith("c1");
    expect(events.publish).toHaveBeenCalledWith({
      type: "access.feature_toggled",
      companyId: "c1",
      actorId: "admin1",
      occurredAt: 42,
      payload: { featureKey: "analytics", enabled: false },
    });
  });
});

describe("AdminService.setSubscription", () => {
  it("404s for an unknown plan", async () => {
    const { service } = build({ findPlanByCode: vi.fn().mockResolvedValue(null) });
    await expect(service.setSubscription(PRINCIPAL, "c1", "ghost")).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it("sets the plan, audits, and invalidates the company cache", async () => {
    const setSub = vi.fn().mockResolvedValue(undefined);
    const { service, audit, events, cache } = build({ setSubscription: setSub });
    const invalidate = vi.spyOn(cache, "invalidateCompany");

    const out = await service.setSubscription(PRINCIPAL, "c1", "pro");

    expect(out).toEqual({ planCode: "pro" });
    expect(setSub).toHaveBeenCalledWith(expect.objectContaining({ companyId: "c1", planId: "p1" }));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "subscription.changed" }),
    );
    expect(invalidate).toHaveBeenCalledWith("c1");
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "subscription.changed", payload: { planCode: "pro" } }),
    );
  });
});
