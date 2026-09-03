import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient, setTenantContext, setUserContext } from "@cadeau/database";
import type { TenancyRepositoryPort } from "../domain/tenancy-repository.port";
import { SlugAlreadyTakenError } from "../domain/tenancy.errors";
import type {
  AcceptOutcome,
  AcceptWarehouseJoinCodeOutcome,
  CompanyRecord,
  InvitationRecord,
  MembershipCompany,
  MemberView,
  MeProfileRow,
  RemoveMemberOutcome,
} from "../domain/tenancy.types";
import { VENDOR_ROLE } from "../domain/tenancy-roles";
import { resolveCapabilities } from "../../../shared/access/capabilities";
import { TENANCY_PRISMA_CLIENT } from "./prisma-client.provider";

/**
 * Every newly created company starts on a one-month "pro" trial (no admin
 * action required). Enforcement of the trial's expiry is not implemented yet
 * (access.repository only checks that a Subscription row exists, not its
 * status/currentPeriodEnd) — see docs/access-review.md for the follow-up.
 */
const TRIAL_PLAN_CODE = "pro";

const COMPANY_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  phone: true,
  monthlyOrdersRange: true,
  country: true,
  facebookHandle: true,
  instagramHandle: true,
  websiteUrl: true,
  shippingCarrier: true,
  whatsappCountryCode: true,
  createdAt: true,
} as const;

const INVITATION_SELECT = {
  id: true,
  companyId: true,
  role: true,
  customPermissionKeys: true,
  status: true,
  expiresAt: true,
  createdAt: true,
} as const;

type CompanyRow = Prisma.CompanyGetPayload<{ select: typeof COMPANY_SELECT }>;
type InvitationRow = Prisma.InvitationGetPayload<{ select: typeof INVITATION_SELECT }>;

/**
 * Prisma-backed {@link TenancyRepositoryPort}. The ONLY place in the tenancy
 * module that touches `@cadeau/database`.
 *
 * Reads bind the caller (`setUserContext`) so RLS scopes profiles/company_members
 * to the principal and their companies. Tenant writes bind the target company
 * (`setTenantContext`). Company creation and invite acceptance bind the user
 * first (the widened bootstrap policies), then the new tenant for the writes.
 */
@Injectable()
export class TenancyRepository implements TenancyRepositoryPort {
  constructor(@Inject(TENANCY_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findProfile(userId: string): Promise<MeProfileRow | null> {
    return this.prisma.$transaction(async (tx) => {
      await setUserContext(tx, userId);
      return tx.profile.findFirst({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          fullName: true,
          phoneEncrypted: true,
          totpEnabledAt: true,
        },
      });
    });
  }

  async listUserCompanies(userId: string): Promise<MembershipCompany[]> {
    const rows = await this.prisma.$transaction(async (tx) => {
      await setUserContext(tx, userId);
      return tx.companyMember.findMany({
        where: { userId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          role: true,
          status: true,
          company: { select: { id: true, name: true, slug: true, whatsappCountryCode: true } },
        },
      });
    });
    return rows.map((row) => ({
      id: row.company.id,
      name: row.company.name,
      slug: row.company.slug,
      role: row.role,
      status: row.status,
      whatsappCountryCode: row.company.whatsappCountryCode,
    }));
  }

  async createCompanyWithOwner(input: {
    readonly companyId: string;
    readonly name: string;
    readonly slug: string | null;
    readonly userId: string;
    readonly phone: string;
    readonly monthlyOrdersRange: string;
    readonly country: string | null;
    readonly facebookHandle: string | null;
    readonly instagramHandle: string | null;
    readonly websiteUrl: string | null;
    readonly shippingCarrier: string | null;
    readonly trialEndsAt: Date;
  }): Promise<CompanyRecord> {
    try {
      const company = await this.prisma.$transaction(async (tx) => {
        await setUserContext(tx, input.userId);
        const created = await tx.company.create({
          data: {
            id: input.companyId,
            name: input.name,
            slug: input.slug,
            status: "active",
            phone: input.phone,
            monthlyOrdersRange: input.monthlyOrdersRange,
            country: input.country,
            facebookHandle: input.facebookHandle,
            instagramHandle: input.instagramHandle,
            websiteUrl: input.websiteUrl,
            shippingCarrier: input.shippingCarrier,
            createdBy: input.userId,
            updatedBy: input.userId,
          },
          select: COMPANY_SELECT,
        });
        // Bind the freshly-created tenant so the owner membership passes the
        // strict tenant policy (company_id = the active tenant).
        await setTenantContext(tx, input.companyId);
        await tx.companyMember.create({
          data: {
            companyId: input.companyId,
            userId: input.userId,
            role: "owner",
            status: "active",
            createdBy: input.userId,
            updatedBy: input.userId,
          },
        });
        // Auto-provision a free trial so a new company has full access from
        // day one. Silently skipped if the catalog has no "pro" plan seeded
        // (never expected outside a broken environment) — a missing trial
        // must not block company creation itself.
        const plan = await tx.plan.findUnique({
          where: { code: TRIAL_PLAN_CODE },
          select: { id: true },
        });
        if (plan !== null) {
          await tx.subscription.create({
            data: {
              companyId: input.companyId,
              planId: plan.id,
              status: "trialing",
              currentPeriodEnd: input.trialEndsAt,
              createdBy: input.userId,
              updatedBy: input.userId,
            },
          });
        }
        return created;
      });
      return toCompanyRecord(company);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new SlugAlreadyTakenError();
      }
      throw error;
    }
  }

  async findActiveMembership(userId: string, companyId: string): Promise<{ role: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      await setUserContext(tx, userId);
      return tx.companyMember.findFirst({
        where: { userId, companyId, status: "active" },
        select: { role: true },
      });
    });
  }

  async updateWhatsappCountryCode(
    companyId: string,
    actorId: string,
    countryCode: string | null,
  ): Promise<CompanyRecord | null> {
    const row = await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      const { count } = await tx.company.updateMany({
        where: { id: companyId },
        data: { whatsappCountryCode: countryCode, updatedBy: actorId },
      });
      if (count === 0) return null;
      return tx.company.findFirst({ where: { id: companyId }, select: COMPANY_SELECT });
    });
    return row === null ? null : toCompanyRecord(row);
  }

  async createInvitation(input: {
    readonly companyId: string;
    readonly role: string;
    readonly customPermissionKeys?: readonly string[];
    readonly codeHash: string;
    readonly expiresAt: Date;
    readonly actorId: string;
  }): Promise<InvitationRecord> {
    const row = await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, input.companyId);
      return tx.invitation.create({
        data: {
          companyId: input.companyId,
          role: input.role,
          customPermissionKeys: [...(input.customPermissionKeys ?? [])],
          codeHash: input.codeHash,
          status: "pending",
          expiresAt: input.expiresAt,
          createdBy: input.actorId,
          updatedBy: input.actorId,
        },
        select: INVITATION_SELECT,
      });
    });
    return toInvitationRecord(row);
  }

  async revokeInvitation(input: {
    readonly companyId: string;
    readonly invitationId: string;
    readonly actorId: string;
  }): Promise<boolean> {
    const result = await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, input.companyId);
      return tx.invitation.updateMany({
        where: { id: input.invitationId, companyId: input.companyId, status: "pending" },
        data: { status: "revoked", revokedAt: new Date(), updatedBy: input.actorId },
      });
    });
    return result.count > 0;
  }

  async listInvitations(companyId: string): Promise<InvitationRecord[]> {
    const rows = await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return tx.invitation.findMany({
        where: { companyId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 200,
        select: INVITATION_SELECT,
      });
    });
    return rows.map(toInvitationRecord);
  }

  async listCompanyAvailablePermissionKeys(companyId: string): Promise<string[]> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);

      const [subscription, activeFeatures, flags, addOns, allPermissions, featurePermissionEdges] =
        await Promise.all([
          tx.subscription.findUnique({
            where: { companyId },
            select: { plan: { select: { features: { select: { featureKey: true } } } } },
          }),
          tx.feature.findMany({ where: { isActive: true }, select: { key: true } }),
          tx.companyFeatureFlag.findMany({
            where: { companyId },
            select: { featureKey: true, enabled: true },
          }),
          tx.addOn.findMany({ where: { companyId }, select: { featureKey: true } }),
          tx.permission.findMany({ select: { key: true } }),
          tx.featurePermission.findMany({ select: { featureKey: true, permissionKey: true } }),
        ]);

      // Reuses the shared, unit-tested three-layer resolver (ADR-0003) with the
      // FULL permission catalog as the base set instead of one role's template —
      // this is "everything the company's plan/features make available", not any
      // one member's grant. `resolveCapabilities` itself is untouched.
      const caps = resolveCapabilities({
        planFeatureKeys: (subscription?.plan.features ?? []).map((f) => f.featureKey),
        activeFeatureKeys: activeFeatures.map((f) => f.key),
        featureFlags: flags,
        addOnFeatureKeys: addOns.map((a) => a.featureKey),
        role: null,
        rolePermissionKeys: allPermissions.map((p) => p.key),
        memberPermissions: [],
        featurePermissionEdges,
      });
      return [...caps.permissions];
    });
  }

  async listMembers(companyId: string): Promise<MemberView[]> {
    const rows = await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return tx.companyMember.findMany({
        where: { companyId, status: "active" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          userId: true,
          role: true,
          status: true,
          createdAt: true,
          user: { select: { fullName: true, email: true } },
        },
      });
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      name: r.user.fullName,
      email: r.user.email,
      role: r.role,
      status: r.status,
      joinedAt: r.createdAt,
    }));
  }

  async removeMember(input: {
    readonly companyId: string;
    readonly memberId: string;
    readonly actorId: string;
  }): Promise<RemoveMemberOutcome> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, input.companyId);
      const member = await tx.companyMember.findFirst({
        where: { id: input.memberId, companyId: input.companyId, status: "active" },
        select: { id: true, role: true },
      });
      if (member === null) {
        return { kind: "not_found" };
      }
      if (member.role === "owner") {
        // Mirrors createInvitation's own-role-must-be-owner rule: removing an
        // Owner is at least as sensitive as inviting one, so it gets the same
        // ceiling — access.manage alone (the route's only guard) isn't enough.
        const actor = await tx.companyMember.findFirst({
          where: { companyId: input.companyId, userId: input.actorId, status: "active" },
          select: { role: true },
        });
        if (actor?.role !== "owner") {
          return { kind: "not_owner" };
        }
        const ownerCount = await tx.companyMember.count({
          where: { companyId: input.companyId, role: "owner", status: "active" },
        });
        if (ownerCount <= 1) {
          return { kind: "last_owner" };
        }
      }
      await tx.companyMember.delete({ where: { id: member.id } });
      return { kind: "removed" };
    });
  }

  async acceptInvitationByCode(input: {
    readonly codeHash: string;
    readonly userId: string;
  }): Promise<AcceptOutcome> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Resolve the invite pre-tenant (user context only ⇒ code-lookup policy).
      await setUserContext(tx, input.userId);
      const invite = await tx.invitation.findFirst({
        where: { codeHash: input.codeHash },
        select: {
          id: true,
          companyId: true,
          role: true,
          customPermissionKeys: true,
          status: true,
          revokedAt: true,
          expiresAt: true,
        },
      });
      if (
        invite === null ||
        invite.status !== "pending" ||
        invite.revokedAt !== null ||
        invite.expiresAt.getTime() <= Date.now()
      ) {
        return { kind: "invalid" };
      }

      // 2. Bind the invite's tenant for the membership insert + status update.
      await setTenantContext(tx, invite.companyId);
      const existing = await tx.companyMember.findFirst({
        where: { companyId: invite.companyId, userId: input.userId },
        select: { role: true },
      });
      if (existing !== null) {
        return { kind: "already_member", companyId: invite.companyId, role: existing.role };
      }
      const member = await tx.companyMember.create({
        data: {
          companyId: invite.companyId,
          userId: input.userId,
          role: invite.role,
          status: "active",
          createdBy: input.userId,
          updatedBy: input.userId,
        },
        select: { id: true },
      });
      // Custom role: `customPermissionKeys` is the entirety of the member's
      // effective set (their `role` is the "custom" sentinel, which resolves
      // to an empty template). Any other role (e.g. "manager"): the service
      // only ever populates this array as an opt-in overlay on top of the
      // role's template, validated in `resolveCustomPermissionKeys`.
      if (invite.customPermissionKeys.length > 0) {
        await tx.memberPermission.createMany({
          data: invite.customPermissionKeys.map((permissionKey) => ({
            companyId: invite.companyId,
            memberId: member.id,
            permissionKey,
            granted: true,
            createdBy: input.userId,
            updatedBy: input.userId,
          })),
        });
      }
      await tx.invitation.updateMany({
        where: { id: invite.id, status: "pending" },
        data: { status: "accepted", acceptedAt: new Date(), acceptedBy: input.userId },
      });
      return { kind: "accepted", companyId: invite.companyId, role: invite.role };
    });
  }

  async acceptWarehouseJoinCodeByCode(input: {
    readonly codeHash: string;
    readonly userId: string;
  }): Promise<AcceptWarehouseJoinCodeOutcome> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Resolve the code pre-tenant (user context only ⇒ the
      // `warehouse_join_codes_lookup` bootstrap policy).
      await setUserContext(tx, input.userId);
      const joinCode = await tx.warehouseJoinCode.findFirst({
        where: { codeHash: input.codeHash, isActive: true },
        select: { companyId: true, warehouseId: true },
      });
      if (joinCode === null) {
        return { kind: "invalid" };
      }

      // 2. Bind the code's tenant for the membership insert.
      await setTenantContext(tx, joinCode.companyId);
      const existing = await tx.companyMember.findFirst({
        where: { companyId: joinCode.companyId, userId: input.userId },
        select: { role: true, warehouseId: true },
      });
      if (existing !== null) {
        return {
          kind: "already_member",
          companyId: joinCode.companyId,
          role: existing.role,
          warehouseId: existing.warehouseId,
        };
      }
      await tx.companyMember.create({
        data: {
          companyId: joinCode.companyId,
          userId: input.userId,
          role: VENDOR_ROLE,
          warehouseId: joinCode.warehouseId,
          status: "active",
          createdBy: input.userId,
          updatedBy: input.userId,
        },
      });
      return {
        kind: "accepted",
        companyId: joinCode.companyId,
        role: VENDOR_ROLE,
        warehouseId: joinCode.warehouseId,
      };
    });
  }
}

function toCompanyRecord(row: CompanyRow): CompanyRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    phone: row.phone,
    monthlyOrdersRange: row.monthlyOrdersRange,
    country: row.country,
    facebookHandle: row.facebookHandle,
    instagramHandle: row.instagramHandle,
    websiteUrl: row.websiteUrl,
    shippingCarrier: row.shippingCarrier,
    whatsappCountryCode: row.whatsappCountryCode,
    createdAt: row.createdAt,
  };
}

function toInvitationRecord(row: InvitationRow): InvitationRecord {
  return {
    id: row.id,
    companyId: row.companyId,
    role: row.role,
    customPermissionKeys: row.customPermissionKeys,
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}
