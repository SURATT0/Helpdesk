import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/db";

/** Prisma client or an active transaction client. */
type Db = Prisma.TransactionClient | typeof prisma;

export type AuditEntry = {
  userId?: number | null;
  action: string;
  entity: string;
  entityId?: number | null;
  meta?: Prisma.InputJsonValue;
};

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
};
