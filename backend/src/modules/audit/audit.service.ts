import type { AuthUser } from "../../shared/auth";
import {
  auditRepository,
  type AuditFilter,
  type AuditLogDto,
} from "./audit.repository";

/**
 * Audit trail reads. There is deliberately no write method here: audit rows are
 * only ever written by `auditRepository.record` from inside the transaction of
 * the mutation they describe, never from a request handler. The trail is
 * append-only — nothing in the codebase updates or deletes an audit row.
 */
export const auditService = {
  list(
    filter: AuditFilter,
    user: AuthUser,
  ): Promise<{ items: AuditLogDto[]; total: number }> {
    // Row scope lives in the repository's WHERE clause, not here.
    return auditRepository.findMany(filter, user);
  },

  actions(user: AuthUser): Promise<string[]> {
    return auditRepository.distinctActions(user);
  },
};
