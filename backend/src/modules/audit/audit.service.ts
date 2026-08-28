import { maySeeWorkloadOf, type AuthUser } from "../../shared/auth";
import { Forbidden } from "../../shared/errors";
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
  /**
   * `userId` narrows the trail to one actor, and the response carries a `total`
   * for the same filter — so `?userId=7&action=ticket` answers "how many ticket
   * actions has that person performed" in one number, which is a workload figure
   * by another name. It is gated by the same predicate as the workload report.
   *
   * The actor COLUMN stays visible to everyone who may read the trail: saying who
   * did what is the entire purpose of an audit log, and removing it would empty
   * `audit:read` of meaning. What this closes is the ready-made per-person
   * counter; a reader can still page the trail and tally by hand, which is a
   * deliberate limit of gating a filter rather than the data — see the summary.
   */
  list(
    filter: AuditFilter,
    user: AuthUser,
  ): Promise<{ items: AuditLogDto[]; total: number }> {
    if (filter.userId != null && !maySeeWorkloadOf(user, filter.userId)) {
      throw Forbidden("You may only filter the audit trail by your own actions");
    }
    // Row scope lives in the repository's WHERE clause, not here.
    return auditRepository.findMany(filter, user);
  },

  actions(user: AuthUser): Promise<string[]> {
    return auditRepository.distinctActions(user);
  },
};
