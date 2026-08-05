import {
  canTransition,
  type Priority,
  type TicketStatus,
} from "../../shared/domain";
import type { AuthUser } from "../../shared/auth";
import {
  BadRequest,
  Forbidden,
  IllegalTransition,
  NotFound,
  ReopenWindowExpired,
} from "../../shared/errors";
import { notificationRepository } from "../notifications/notification.repository";
import { mayReceiveAssignment } from "./ticket.scope";
import { resolvePeriod, type Granularity, type Period } from "./history.period";
import { formatRemaining, slaAlertKind, SLA_WARN_MS } from "./sla";
import { ACTIVE_STATUSES } from "./ticket.validators";

/**
 * Ceiling on how many periods the picker lists. Years and months are naturally
 * few, but weeks grow without bound over a long-lived archive, and a dropdown of
 * hundreds of entries is not a picker. Not a silent truncation — the response
 * reports whether it clipped, so the client can say the list is partial.
 */
export const PERIOD_LIST_LIMIT = 60;

/** One populated period in the picker: the window plus how many it holds. */
export type ClosedPeriod = { start: Date; end: Date; count: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const REOPEN_WINDOW_MS = 30 * DAY_MS;
const AUTO_CLOSE_MS = 72 * 60 * 60 * 1000;

/**
 * Notification `type` per SLA alert kind. Distinct types are what make the
 * sweep's dedupe work per-stage: being warned does not suppress the later breach.
 */
export const SLA_ALERT_TYPE = {
  warning: "ticket.sla_warning",
  breach: "ticket.sla_breach",
} as const;
import {
  ticketRepository,
  type CreateTicketInput,
  type HistoryEntry,
  type Ticket,
  type TicketFilter,
} from "./ticket.repository";

/**
 * Ceiling on one reassignment call. Not a silent truncation — the result reports
 * how many tickets were left over so the caller can repeat the call and, more
 * importantly, knows the queue was not fully drained.
 */
const REASSIGN_BATCH_LIMIT = 500;

export type ReassignInput = {
  fromUserId: number;
  toUserId: number | null;
  /** Defaults to ACTIVE_STATUSES — the work still in flight. */
  statuses?: TicketStatus[];
};

export type ReassignResult = {
  fromUserId: number;
  toUserId: number | null;
  statuses: TicketStatus[];
  movedTicketIds: number[];
  /** Tickets matching the filter that this call did not reach (see the cap). */
  remaining: number;
};

export type ImportRow = {
  subject: string;
  description: string;
  priority: Priority;
  category: string;
  requesterEmail: string;
};

export type ImportRowResult =
  | { index: number; ok: true; ticketId: number }
  | { index: number; ok: false; field: string | null; error: string };

export type ImportResult = {
  created: number;
  failed: number;
  results: ImportRowResult[];
};

/**
 * Business logic. Never touches SQL — talks to the repository. Enforces the
 * status transition whitelist; the repository appends the ticket_status_history
 * row atomically with the update. Notifications will be fired here once the
 * notifications module lands.
 */
export const ticketService = {
  list(filter: TicketFilter, user: AuthUser): Promise<Ticket[]> {
    return ticketRepository.findMany(filter, user);
  },

  /**
   * Which periods actually hold closed tickets, newest first, with a count each —
   * what the history log's period picker lists.
   *
   * Only populated periods are returned, so the picker never offers a window that
   * would come back empty, and the list stays short without needing a date range
   * from the caller. Buckets are derived with `resolvePeriod`, the same function
   * that resolves the window being viewed, so a period in the picker and the
   * window it jumps to can never disagree about where a month starts.
   */
  async closedPeriods(
    granularity: Granularity,
    user: AuthUser,
  ): Promise<{ periods: ClosedPeriod[]; truncated: boolean }> {
    const values = await ticketRepository.findClosedAtValues(user);

    const buckets = new Map<number, ClosedPeriod>();
    for (const closedAt of values) {
      const { start, end } = resolvePeriod(granularity, closedAt);
      const key = start.getTime();
      const existing = buckets.get(key);
      if (existing) existing.count++;
      else buckets.set(key, { start, end, count: 1 });
    }

    const all = [...buckets.values()].sort(
      (a, b) => b.start.getTime() - a.start.getTime(),
    );
    return {
      periods: all.slice(0, PERIOD_LIST_LIMIT),
      truncated: all.length > PERIOD_LIST_LIMIT,
    };
  },

  /**
   * The closed-ticket history log for one calendar period. Resolves the window
   * here rather than accepting raw `from`/`to` from the client so that "this
   * month" means one thing across the app, and echoes the resolved period back
   * so the client can label it and drive prev/next without repeating the maths.
   */
  async closedHistory(
    input: {
      granularity: Granularity;
      anchor?: Date;
      limit: number;
      offset: number;
    },
    user: AuthUser,
  ): Promise<{ items: Ticket[]; total: number; period: Period }> {
    const period = resolvePeriod(
      input.granularity,
      input.anchor ?? new Date(),
    );
    const { items, total } = await ticketRepository.findClosedInPeriod(
      {
        start: period.start,
        end: period.end,
        limit: input.limit,
        offset: input.offset,
      },
      user,
    );
    return { items, total, period };
  },

  create(
    input: Omit<CreateTicketInput, "requesterId">,
    user: AuthUser,
  ): Promise<Ticket> {
    // The requester is always the authenticated user.
    return ticketRepository.create({ ...input, requesterId: user.id });
  },

  /**
   * Bulk-create tickets from parsed CSV rows. Each row is resolved and created
   * independently (like the bulk-action fan-out): the category name → id and
   * requester email → user id are looked up, and a row that can't be resolved
   * fails on its own with a field-tagged reason rather than aborting the batch.
   * The importing user is recorded as the actor; the requester comes from the
   * row's email. Returns per-row results so the client can offer fixes.
   */
  async importMany(rows: ImportRow[], user: AuthUser): Promise<ImportResult> {
    const results: ImportRowResult[] = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      try {
        const categoryId = await ticketRepository.findCategoryIdByName(
          row.category,
        );
        if (categoryId == null) {
          results.push({
            index,
            ok: false,
            field: "category",
            error: `Unknown category "${row.category}"`,
          });
          continue;
        }
        const requesterId = await ticketRepository.findUserIdByEmail(
          row.requesterEmail,
        );
        if (requesterId == null) {
          results.push({
            index,
            ok: false,
            field: "requesterEmail",
            error: `No user with email "${row.requesterEmail}"`,
          });
          continue;
        }
        const ticket = await ticketRepository.create({
          subject: row.subject,
          description: row.description,
          priority: row.priority,
          categoryId,
          requesterId,
          actorId: user.id,
        });
        results.push({ index, ok: true, ticketId: ticket.id });
      } catch (err) {
        results.push({
          index,
          ok: false,
          field: null,
          error: err instanceof Error ? err.message : "Failed to create ticket",
        });
      }
    }
    const created = results.filter((r) => r.ok).length;
    return { created, failed: results.length - created, results };
  },

  async get(id: number, user: AuthUser): Promise<Ticket> {
    const ticket = await ticketRepository.findById(id, user);
    if (!ticket) throw NotFound(`Ticket #${id} not found`);
    return ticket;
  },

  async history(id: number, user: AuthUser): Promise<HistoryEntry[]> {
    await this.get(id, user); // authorize via row scope (404 if out of scope)
    return ticketRepository.findHistory(id);
  },

  /**
   * Soft-delete a ticket. The route already restricts this to `ticket:delete`
   * (super_admin only); the row-scope check here is the second half — a customer's
   * own super admin must not reach another tenant's ticket, which `get` enforces by
   * 404ing anything outside their scope.
   *
   * Closing is still the normal end of a ticket's life. This exists for the row
   * that should never have been raised, so it is deliberately not offered as a
   * status transition.
   */
  async remove(id: number, user: AuthUser): Promise<void> {
    await this.get(id, user); // authorize via row scope (404 if out of scope)
    await ticketRepository.softDelete(id, user.id);
  },

  /**
   * Replace the ticket's affected users. Deliberately NOT derived from the
   * session: the affected party is whoever the agent selects, which is often
   * not the logged-in user and not the requester either.
   */
  async setAffectedUsers(
    id: number,
    userIds: number[],
    user: AuthUser,
  ): Promise<Ticket> {
    const updated = await ticketRepository.setAffectedUsers(id, userIds, user);
    if (!updated) throw NotFound(`Ticket #${id} not found`);
    return updated;
  },

  /** Replace the ticket's affected assets. Same stance as affected users. */
  async setAffectedAssets(
    id: number,
    assetIds: number[],
    user: AuthUser,
  ): Promise<Ticket> {
    const updated = await ticketRepository.setAffectedAssets(id, assetIds, user);
    if (!updated) throw NotFound(`Ticket #${id} not found`);
    return updated;
  },

  async changeStatus(
    id: number,
    next: TicketStatus,
    user: AuthUser,
  ): Promise<Ticket> {
    // get() applies row scope, so an out-of-scope ticket 404s before any write.
    const ticket = await this.get(id, user);
    if (ticket.status !== next && !canTransition(ticket.status, next)) {
      throw IllegalTransition(ticket.status, next);
    }
    // Reopen is only allowed within 30 days of closing; beyond that, a new ticket.
    if (ticket.status === "closed" && next === "open" && ticket.closedAt) {
      if (Date.now() - Date.parse(ticket.closedAt) > REOPEN_WINDOW_MS) {
        throw ReopenWindowExpired();
      }
    }
    const updated = await ticketRepository.updateStatus(id, next, user.id);
    if (!updated) throw NotFound(`Ticket #${id} not found`);
    return updated;
  },

  async changeAssignee(
    id: number,
    assigneeId: number | null,
    user: AuthUser,
  ): Promise<Ticket> {
    await this.get(id, user); // row scope → 404 before any write
    const updated = await ticketRepository.updateAssignee(id, assigneeId, user.id);
    if (!updated) throw NotFound(`Ticket #${id} not found`);
    return updated;
  },

  /**
   * Move one person's whole queue to another (or back to unassigned) — the
   * "agent is on leave / has left" case, where reassigning ticket by ticket is
   * the wrong tool.
   *
   * Deliberately loops the single-ticket assign path rather than issuing one bulk
   * UPDATE: every move must append its own audit row and notify the participants,
   * and a set-based update would silently skip both.
   *
   * Two independent guards, because neither covers the other:
   *   - which tickets move is bounded by `ticketScopeWhere` in the repository, so
   *     a manager cannot reach another customer's tickets by passing a user id;
   *   - who may receive them is `mayReceiveAssignment`, which a where-clause on
   *     tickets cannot express.
   */
  async reassignAll(
    input: ReassignInput,
    user: AuthUser,
  ): Promise<ReassignResult> {
    if (input.toUserId === input.fromUserId) {
      throw BadRequest("Source and target assignee are the same");
    }

    if (input.toUserId != null) {
      const candidate = await ticketRepository.findAssignmentCandidate(
        input.toUserId,
      );
      if (!candidate) throw BadRequest(`Unknown user #${input.toUserId}`);
      if (!mayReceiveAssignment(user, candidate)) {
        // Same message either way: telling a manager apart "that user is in
        // another customer" from "that user is a requester" would leak the
        // directory of tenants they cannot see.
        throw Forbidden(`User #${input.toUserId} cannot be assigned tickets`);
      }
    }

    const statuses = input.statuses ?? [...ACTIVE_STATUSES];
    const { ids, remaining } = await ticketRepository.findIdsByAssignee(
      input.fromUserId,
      statuses,
      user,
      REASSIGN_BATCH_LIMIT,
    );

    const movedTicketIds: number[] = [];
    for (const id of ids) {
      const updated = await ticketRepository.updateAssignee(
        id,
        input.toUserId,
        user.id,
      );
      if (updated) movedTicketIds.push(id);
    }

    return {
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      statuses,
      movedTicketIds,
      remaining,
    };
  },

  async changePriority(
    id: number,
    priority: Priority,
    user: AuthUser,
  ): Promise<Ticket> {
    await this.get(id, user); // row scope → 404 before any write
    const updated = await ticketRepository.updatePriority(id, priority, user.id);
    if (!updated) throw NotFound(`Ticket #${id} not found`);
    return updated;
  },

  /**
   * Auto-close tickets left in `resolved` for more than 72h (no confirmation /
   * reopen). Runs as a system action (no actor) — reuses updateStatus so a
   * status-history row, audit entry, and notifications are written. Returns the
   * number of tickets closed. Invoked by the scheduler in server.ts.
   */
  async autoCloseStale(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - AUTO_CLOSE_MS);
    const ids = await ticketRepository.findStaleResolved(cutoff);
    for (const id of ids) {
      await ticketRepository.updateStatus(id, "closed");
    }
    return ids.length;
  },

  /**
   * Notify staff about SLA clocks that are close to expiring or already expired.
   *
   * Until now the SLA existed only as a colour computed on read (`deriveSla`), so
   * a breach was something you noticed if you happened to be looking at the right
   * list. This turns it into a push.
   *
   * Runs as a system action with no actor. Recipients are the assignee, or — when
   * nobody owns the ticket yet, which is exactly when a breach is most likely to
   * go unnoticed — the managers of that ticket's customer. Requesters are never
   * notified: the SLA is an internal commitment, not a promise made to them.
   *
   * Idempotent across runs: the sweep re-sees the same tickets every 15 minutes,
   * so each `(ticket, recipient, kind)` is notified at most once. `warning` and
   * `breach` are separate kinds, so a ticket that was warned about still produces
   * a breach alert when it crosses the line.
   */
  async sweepSlaAlerts(
    now: Date = new Date(),
  ): Promise<{ warned: number; breached: number }> {
    const horizon = new Date(now.getTime() + SLA_WARN_MS);
    const atRisk = await ticketRepository.findSlaRisk(horizon);
    if (atRisk.length === 0) return { warned: 0, breached: 0 };

    const existing = await notificationRepository.findExistingKeys(
      Object.values(SLA_ALERT_TYPE),
      atRisk.map((t) => t.id),
    );

    // One lookup per distinct customer, not per ticket.
    const escalationByCustomer = new Map<number, number[]>();
    const escalateTo = async (customerId: number | null) => {
      if (customerId == null) return [];
      const cached = escalationByCustomer.get(customerId);
      if (cached) return cached;
      const ids = await ticketRepository.findCustomerSuperAdminIds(customerId);
      escalationByCustomer.set(customerId, ids);
      return ids;
    };

    const entries: Array<{
      userId: number;
      type: string;
      ticketId: number;
      message: string;
    }> = [];
    let warned = 0;
    let breached = 0;

    for (const ticket of atRisk) {
      const kind = slaAlertKind(ticket.dueAt, now);
      if (!kind) continue;
      const type = SLA_ALERT_TYPE[kind];

      const recipients =
        ticket.assigneeId != null
          ? [ticket.assigneeId]
          : await escalateTo(ticket.customerId);

      let notifiedForThisTicket = false;
      for (const userId of new Set(recipients)) {
        const key = `${ticket.id}:${userId}:${type}`;
        if (existing.has(key)) continue;
        entries.push({
          userId,
          type,
          ticketId: ticket.id,
          message:
            kind === "breach"
              ? `Ticket #${ticket.id} has breached its SLA`
              : `Ticket #${ticket.id} breaches SLA in ${formatRemaining(
                  ticket.dueAt!.getTime() - now.getTime(),
                )}`,
        });
        notifiedForThisTicket = true;
      }
      // Count tickets alerted on, not notification rows — a ticket with three
      // manager recipients is one breach, not three.
      if (notifiedForThisTicket) {
        if (kind === "breach") breached++;
        else warned++;
      }
    }

    await notificationRepository.createMany(entries);
    return { warned, breached };
  },
};
