import { Inject, Injectable } from "@nestjs/common";
import {
  buildKeysetPage,
  clampLimit,
  decodeCursor,
  InvalidCursorError,
  type KeysetPage,
  Prisma,
  type PrismaClient,
  setTenantContext,
  setUserContext,
} from "@cadeau/database";
import { InvalidCursorInputError } from "../domain/access.errors";
import type {
  AccessManagementRepositoryPort,
  AssignMemberPermissionsInput,
  AssignMemberPermissionsResult,
} from "../domain/access-management.port";
import type {
  AdminCompanyView,
  AvailablePermissionView,
  FeatureCatalogEntry,
  MemberPermissionOverride,
  MemberPermissionsSnapshot,
  MemberRow,
  PermissionTemplateView,
} from "../domain/access.types";
import { resolveCapabilities } from "../../../shared/access/capabilities";
import { ACCESS_MODULE_PRISMA_CLIENT } from "./prisma-client.provider";

/**
 * Prisma-backed access management + Super-Admin reads/writes. The ONLY place in
 * the access module that touches `@cadeau/database`. Tenant operations bind the
 * active/target company (`setTenantContext`) so RLS scopes them; catalog reads
 * are unrestricted; the cross-tenant company listing binds the admin's user
 * (`setUserContext`) so the platform-admin RLS clause returns every company.
 */
@Injectable()
export class AccessManagementRepository implements AccessManagementRepositoryPort {
  constructor(@Inject(ACCESS_MODULE_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async listFeatureCatalog(): Promise<FeatureCatalogEntry[]> {
    const rows = await this.prisma.feature.findMany({
      orderBy: { key: "asc" },
      select: { key: true, name: true, category: true, isActive: true },
    });
    return rows.map((r) => ({
      key: r.key,
      name: r.name,
      category: r.category,
      isActive: r.isActive,
    }));
  }

  async listPermissionTemplates(): Promise<PermissionTemplateView[]> {
    const rows = await this.prisma.permissionTemplate.findMany({
      orderBy: { key: "asc" },
      select: {
        key: true,
        name: true,
        description: true,
        permissions: { select: { permissionKey: true }, orderBy: { permissionKey: "asc" } },
      },
    });
    return rows.map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      permissions: r.permissions.map((p) => p.permissionKey),
    }));
  }

  async listTemplateKeys(): Promise<string[]> {
    const rows = await this.prisma.permissionTemplate.findMany({ select: { key: true } });
    return rows.map((r) => r.key);
  }

  async listAvailablePermissions(companyId: string): Promise<AvailablePermissionView[]> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);

      const [subscription, activeFeatures, flags, addOns, catalog, featurePermissionEdges] =
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
          tx.permission.findMany({ select: { key: true, description: true } }),
          tx.featurePermission.findMany({ select: { featureKey: true, permissionKey: true } }),
        ]);

      // Same three-layer resolution `createInvitation`'s server-side custom-role
      // check uses (ADR-0003), fed the full catalog instead of one role's
      // template — "everything the company's plan/features make available".
      const caps = resolveCapabilities({
        planFeatureKeys: (subscription?.plan.features ?? []).map((f) => f.featureKey),
        activeFeatureKeys: activeFeatures.map((f) => f.key),
        featureFlags: flags,
        addOnFeatureKeys: addOns.map((a) => a.featureKey),
        role: null,
        rolePermissionKeys: catalog.map((p) => p.key),
        memberPermissions: [],
        featurePermissionEdges,
      });
      const available = new Set(caps.permissions);

      const featureKeyByPermission = new Map<string, string>();
      for (const edge of featurePermissionEdges) {
        featureKeyByPermission.set(edge.permissionKey, edge.featureKey);
      }

      return catalog
        .filter((p) => available.has(p.key))
        .map((p) => ({
          key: p.key,
          description: p.description,
          featureKey: featureKeyByPermission.get(p.key) ?? null,
        }));
    });
  }

  async findMember(companyId: string, memberId: string): Promise<MemberRow | null> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      const row = await tx.companyMember.findFirst({
        where: { id: memberId, companyId },
        select: { id: true, userId: true, role: true },
      });
      return row === null ? null : { id: row.id, userId: row.userId, role: row.role };
    });
  }

  async assignMemberPermissions(
    input: AssignMemberPermissionsInput,
  ): Promise<AssignMemberPermissionsResult> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, input.companyId);

      const member = await tx.companyMember.findFirst({
        where: { id: input.memberId, companyId: input.companyId },
        select: { id: true, userId: true, role: true },
      });
      if (member === null) {
        throw new Error("member_not_found");
      }

      const beforeOverrides = await this.readOverrides(tx, input.companyId, member.id);
      const before: MemberPermissionsSnapshot = { role: member.role, overrides: beforeOverrides };

      let role = member.role;
      if (input.templateKey !== undefined) {
        role = input.templateKey;
        await tx.companyMember.updateMany({
          where: { id: member.id, companyId: input.companyId },
          data: { role: input.templateKey, updatedBy: input.actorId },
        });
      }

      if (input.overrides !== undefined) {
        await tx.memberPermission.deleteMany({
          where: { companyId: input.companyId, memberId: member.id },
        });
        for (const override of input.overrides) {
          await tx.memberPermission.create({
            data: {
              companyId: input.companyId,
              memberId: member.id,
              permissionKey: override.key,
              granted: override.granted,
              createdBy: input.actorId,
              updatedBy: input.actorId,
            },
          });
        }
      }

      const afterOverrides = await this.readOverrides(tx, input.companyId, member.id);
      const after: MemberPermissionsSnapshot = { role, overrides: afterOverrides };

      return { before, after, memberUserId: member.userId };
    });
  }

  private async readOverrides(
    tx: Prisma.TransactionClient,
    companyId: string,
    memberId: string,
  ): Promise<MemberPermissionOverride[]> {
    const rows = await tx.memberPermission.findMany({
      where: { companyId, memberId },
      orderBy: { permissionKey: "asc" },
      select: { permissionKey: true, granted: true },
    });
    return rows.map((r) => ({ key: r.permissionKey, granted: r.granted }));
  }

  async listAllCompanies(
    adminUserId: string,
    rawLimit: number | undefined,
    rawCursor: string | undefined,
  ): Promise<KeysetPage<AdminCompanyView>> {
    const limit = clampLimit(rawLimit);
    const cursor = decodeCompaniesCursor(rawCursor);
    const rows = await this.prisma.$transaction(async (tx) => {
      // Bind the admin's user so the platform-admin RLS clause returns every company.
      await setUserContext(tx, adminUserId);
      const where =
        cursor === null
          ? {}
          : {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
              ],
            };
      return tx.company.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          createdAt: true,
          subscription: { select: { plan: { select: { code: true } } } },
        },
      });
    });
    const views: AdminCompanyView[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      status: r.status,
      planCode: r.subscription?.plan.code ?? null,
      createdAt: r.createdAt,
    }));
    return buildKeysetPage(views, limit, (row) => ({
      createdAt: row.createdAt.toISOString(),
      id: row.id,
    }));
  }

  async findPlanByCode(code: string): Promise<{ id: string; code: string } | null> {
    const row = await this.prisma.plan.findUnique({
      where: { code },
      select: { id: true, code: true },
    });
    return row;
  }

  async featureExists(featureKey: string): Promise<boolean> {
    const row = await this.prisma.feature.findUnique({
      where: { key: featureKey },
      select: { key: true },
    });
    return row !== null;
  }

  async setCompanyFeatureFlag(input: {
    readonly companyId: string;
    readonly featureKey: string;
    readonly enabled: boolean;
    readonly actorId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, input.companyId);
      const existing = await tx.companyFeatureFlag.findFirst({
        where: { companyId: input.companyId, featureKey: input.featureKey },
        select: { id: true },
      });
      if (existing === null) {
        await tx.companyFeatureFlag.create({
          data: {
            companyId: input.companyId,
            featureKey: input.featureKey,
            enabled: input.enabled,
            createdBy: input.actorId,
            updatedBy: input.actorId,
          },
        });
      } else {
        await tx.companyFeatureFlag.updateMany({
          where: { id: existing.id, companyId: input.companyId },
          data: { enabled: input.enabled, updatedBy: input.actorId },
        });
      }
    });
  }

  async setSubscription(input: {
    readonly companyId: string;
    readonly planId: string;
    readonly actorId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, input.companyId);
      const existing = await tx.subscription.findUnique({
        where: { companyId: input.companyId },
        select: { id: true },
      });
      if (existing === null) {
        await tx.subscription.create({
          data: {
            companyId: input.companyId,
            planId: input.planId,
            status: "active",
            createdBy: input.actorId,
            updatedBy: input.actorId,
          },
        });
      } else {
        await tx.subscription.updateMany({
          where: { companyId: input.companyId },
          data: { planId: input.planId, updatedBy: input.actorId },
        });
      }
    });
  }
}

/** Decode the companies list cursor, or throw the domain error on garbage. */
function decodeCompaniesCursor(
  raw: string | undefined,
): { readonly createdAt: string; readonly id: string } | null {
  if (raw === undefined) return null;
  try {
    const decoded = decodeCursor(raw);
    const createdAt = decoded["createdAt"];
    const id = decoded["id"];
    if (typeof createdAt !== "string" || typeof id !== "string") {
      throw new InvalidCursorInputError();
    }
    return { createdAt, id };
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      throw new InvalidCursorInputError();
    }
    throw error;
  }
}
