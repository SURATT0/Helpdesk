import { Prisma } from "@prisma/client";
import type { Role } from "../../shared/domain";
import type { AuthUser } from "../../shared/auth";
import { prisma } from "../../shared/db";
import { auditScopeWhere } from "./audit.scope";

/** Prisma client or an active transaction client. */
type Db = Prisma.TransactionClient | typeof prisma;

export type AuditEntry = {
  userId?: number | null;
  action: string;
  entity: string;
  entityId?: number | null;
  meta?: Prisma.InputJsonValue;
};

const auditInclude = {
  user: { select: { id: true, name: true, email: true, role: true } },
} satisfies Prisma.AuditLogInclude;

type AuditRow = Prisma.AuditLogGetPayload<{ include: typeof auditInclude }>;

/** One trail entry as the API returns it. */
export type AuditLogDto = {
  id: number;
  action: string;
  entity: string;
  entityId: number | null;
  /** Null for system writes (no session behind the mutation). */
  actor: { id: number; name: string; email: string; role: Role } | null;
  meta: unknown;
  createdAt: string;
};

export type AuditFilter = {
  entity?: string;
  entityId?: number;
  action?: string;
  userId?: number;
  /** Inclusive lower / exclusive upper bound on createdAt. */
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
};

function toDto(row: AuditRow): AuditLogDto {
  return {
    id: row.id,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    actor: row.user,
    meta: row.meta,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The audit trail. Other repositories call `record(entry, tx)` from inside their
 * own transaction so the audit row commits atomically with the mutation it
 * describes. This module owns the `audit_logs` table.
 */
export const auditRepository = {
  record(entry: AuditEntry, db: Db = prisma) {
    return db.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        meta: entry.meta,
      },
    });
  },

  /**
   * Read the trail, newest first. Row scope comes from `auditScopeWhere` and is
   * AND-ed with the caller's filters, so no filter combination can widen what a
   * viewer sees. `total` is the count within the same scope, for pagination.
   */
  async findMany(
    filter: AuditFilter,
    viewer: AuthUser,
  ): Promise<{ items: AuditLogDto[]; total: number }> {
    const where: Prisma.AuditLogWhereInput = {
      AND: [
        auditScopeWhere(viewer),
        filter.entity ? { entity: filter.entity } : {},
        filter.entityId != null ? { entityId: filter.entityId } : {},
        // Prefix match so "ticket." pulls the whole family of ticket actions.
        filter.action ? { action: { startsWith: filter.action } } : {},
        filter.userId != null ? { userId: filter.userId } : {},
        filter.from ? { createdAt: { gte: filter.from } } : {},
        filter.to ? { createdAt: { lt: filter.to } } : {},
      ],
    };

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: auditInclude,
        orderBy: { id: "desc" },
        take: filter.limit,
        skip: filter.offset,
      }),
      prisma.auditLog.count({ where }),
    ]);
    return { items: rows.map(toDto), total };
  },

  /** The distinct action names present in the viewer's scope, for filter UI. */
  async distinctActions(viewer: AuthUser): Promise<string[]> {
    const rows = await prisma.auditLog.findMany({
      where: auditScopeWhere(viewer),
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    });
    return rows.map((r) => r.action);
  },
};
