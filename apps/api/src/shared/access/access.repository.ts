import { Inject, Injectable } from "@nestjs/common";
import { type PrismaClient, setTenantContext, setUserContext } from "@cadeau/database";
import type {
  AccessRepositoryPort,
  MemberAccessData,
  PlatformAdminRepositoryPort,
} from "./access-repository.port";
import type { AccessData } from "./capabilities";
import { ACCESS_PRISMA_CLIENT } from "./access-prisma-client.provider";

/**
 * Prisma-backed access reads. Tenant facts (subscription, flags, add-ons,
 * membership, member overrides) are read with the company bound as the active
 * tenant so RLS scopes them; the system catalog (features, plans, permissions,
 * templates, edges) is readable by all. Queries run sequentially inside one
 * interactive transaction (Prisma interactive transactions are not concurrent).
 */
@Injectable()
export class AccessRepository implements AccessRepositoryPort {
  constructor(@Inject(ACCESS_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async loadAccessData(userId: string, companyId: string): Promise<AccessData> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);

      const subscription = await tx.subscription.findUnique({
        where: { companyId },
        select: { plan: { select: { features: { select: { featureKey: true } } } } },
      });
      const activeFeatures = await tx.feature.findMany({
        where: { isActive: true },
        select: { key: true },
      });
      const flags = await tx.companyFeatureFlag.findMany({
        where: { companyId },
        select: { featureKey: true, enabled: true },
      });
      const addOns = await tx.addOn.findMany({
        where: { companyId },
        select: { featureKey: true },
      });
      const member = await tx.companyMember.findFirst({
        where: { companyId, userId, status: "active" },
        select: { id: true, role: true },
      });

      let rolePermissionKeys: string[] = [];
      let memberPermissions: { permissionKey: string; granted: boolean }[] = [];
      if (member !== null) {
        const template = await tx.permissionTemplate.findUnique({
          where: { key: member.role },
          select: { permissions: { select: { permissionKey: true } } },
        });
        rolePermissionKeys = (template?.permissions ?? []).map((p) => p.permissionKey);
        memberPermissions = await tx.memberPermission.findMany({
          where: { companyId, memberId: member.id },
          select: { permissionKey: true, granted: true },
        });
      }

      const featurePermissionEdges = await tx.featurePermission.findMany({
        select: { featureKey: true, permissionKey: true },
      });

      return {
        planFeatureKeys: (subscription?.plan.features ?? []).map((f) => f.featureKey),
        activeFeatureKeys: activeFeatures.map((f) => f.key),
        featureFlags: flags,
        addOnFeatureKeys: addOns.map((a) => a.featureKey),
        role: member?.role ?? null,
        rolePermissionKeys,
        memberPermissions,
        featurePermissionEdges,
      } satisfies AccessData;
    });
  }

  async loadCompanyMembersAccessData(companyId: string): Promise<MemberAccessData[]> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);

      const subscription = await tx.subscription.findUnique({
        where: { companyId },
        select: { plan: { select: { features: { select: { featureKey: true } } } } },
      });
      const activeFeatures = await tx.feature.findMany({
        where: { isActive: true },
        select: { key: true },
      });
      const flags = await tx.companyFeatureFlag.findMany({
        where: { companyId },
        select: { featureKey: true, enabled: true },
      });
      const addOns = await tx.addOn.findMany({
        where: { companyId },
        select: { featureKey: true },
      });
      const featurePermissionEdges = await tx.featurePermission.findMany({
        select: { featureKey: true, permissionKey: true },
      });
      const members = await tx.companyMember.findMany({
        where: { companyId, status: "active" },
        select: { id: true, role: true },
      });
      if (members.length === 0) return [];

      const roles = [...new Set(members.map((m) => m.role))];
      const templates = await tx.permissionTemplate.findMany({
        where: { key: { in: roles } },
        select: { key: true, permissions: { select: { permissionKey: true } } },
      });
      const templateKeys = new Map(
        templates.map((t) => [t.key, t.permissions.map((p) => p.permissionKey)]),
      );

      const overrides = await tx.memberPermission.findMany({
        where: { companyId, memberId: { in: members.map((m) => m.id) } },
        select: { memberId: true, permissionKey: true, granted: true },
      });
      const overridesByMember = new Map<string, { permissionKey: string; granted: boolean }[]>();
      for (const o of overrides) {
        const list = overridesByMember.get(o.memberId) ?? [];
        list.push({ permissionKey: o.permissionKey, granted: o.granted });
        overridesByMember.set(o.memberId, list);
      }

      const planFeatureKeys = (subscription?.plan.features ?? []).map((f) => f.featureKey);
      const activeFeatureKeys = activeFeatures.map((f) => f.key);
      const addOnFeatureKeys = addOns.map((a) => a.featureKey);

      return members.map((member) => ({
        memberId: member.id,
        data: {
          planFeatureKeys,
          activeFeatureKeys,
          featureFlags: flags,
          addOnFeatureKeys,
          role: member.role,
          // A `custom` member has no template row: its permissions are all overrides.
          rolePermissionKeys: templateKeys.get(member.role) ?? [],
          memberPermissions: overridesByMember.get(member.id) ?? [],
          featurePermissionEdges,
        } satisfies AccessData,
      }));
    });
  }
}

/**
 * Prisma-backed platform Super-Admin check. Reads the caller's own grant row
 * under user context (the `platform_admins` self-SELECT policy). Never inspects
 * tenant roles — the privilege is isolated by construction.
 */
@Injectable()
export class PlatformAdminRepository implements PlatformAdminRepositoryPort {
  constructor(@Inject(ACCESS_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async isPlatformAdmin(userId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await setUserContext(tx, userId);
      const row = await tx.platformAdmin.findFirst({
        where: { userId },
        select: { id: true },
      });
      return row !== null;
    });
  }
}
