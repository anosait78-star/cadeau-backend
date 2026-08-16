import { Prisma, type PrismaClient, setTenantContext } from "@cadeau/database";

/** The shape every module's tenant-scoped audit record shares. */
export interface GenericAuditRecord {
  readonly companyId: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly changes?: unknown;
}

/**
 * Writes a tenant-scoped row to the durable, append-only `audit_log` (EPIC-3).
 * The company is bound as the active tenant so the row passes the audit_log
 * tenant INSERT policy. Base class for every module's `*AuditLogAdapter` —
 * each subclass exists only to pin the record type and the module's own
 * Prisma-client DI token; the write itself is identical everywhere.
 */
export class AuditLogAdapter<TRecord extends GenericAuditRecord> {
  constructor(private readonly prisma: PrismaClient) {}

  async record(record: TRecord): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, record.companyId);
      await tx.auditLog.create({
        data: {
          companyId: record.companyId,
          actorId: record.actorId,
          action: record.action,
          entityType: record.entityType,
          entityId: record.entityId,
          ...(record.changes === undefined
            ? {}
            : { changes: record.changes as Prisma.InputJsonValue }),
        },
      });
    });
  }
}
