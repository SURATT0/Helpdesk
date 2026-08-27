import { canTransition } from "../../shared/ticket-status";
import {
  type Priority,
  type TicketStatus,
} from "../../shared/domain";
import type { AuthUser } from "../../shared/auth";
import {
  AppError,
  BadRequest,
  Forbidden,
  IllegalTransition,
  NotFound,
  ReopenWindowExpired,
} from "../../shared/errors";
import { auditRepository } from "../audit/audit.repository";
import { commentService } from "../comments/comment.service";
import { notificationRepository } from "../notifications/notification.repository";
import { mayImportForRequester, mayReceiveAssignment } from "./ticket.scope";
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

/**
 * Why a row was refused, as a code rather than a sentence.
 *
 * The client renders these through its own dictionary: `error` below is written
 * in English by this service, and echoing it straight into the UI put an English
 * sentence in the middle of an otherwise Thai screen. The code is what the client
 * translates; the prose stays for API consumers and logs, which have no
 * dictionary to reach for.
 *
 * Values that belong in the message — the category, the address — are NOT sent
 * with the code. The client already holds the row it submitted, and sending them
 * back would be two copies of the same string that can disagree.
 */
export type ImportErrorReason =
  | "unknown_category"
  | "unknown_requester"
  | "create_failed";

export type ImportRowResult =
  | { index: number; ok: true; ticketId: number }
  | {
      index: number;
      ok: false;
      field: string | null;
      reason: ImportErrorReason;
      error: string;
    };

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
   * The closed-ticket history log.
   *
   * `granularity: "all"` reads the whole archive in reach, newest first — the
   * mode a search needs, since narrowing by month presupposes knowing the month.
   * Any other granularity resolves one calendar window HERE rather than accepting
   * raw `from`/`to` from the client, so that "this month" means one thing across
   * the app, and echoes the resolved period back so the client can label it and
   * drive prev/next without repeating the maths. `period` is null in `all` mode:
   * there is no window to label, and inventing one would let a caller navigate
   * relative to a window it never asked for.
   */
  async closedHistory(
    input: {
      granularity: Granularity | "all";
      anchor?: Date;
      limit: number;
      offset: number;
      priority?: Priority;
      q?: string;
    },
    user: AuthUser,
  ): Promise<{ items: Ticket[]; total: number; period: Period | null }> {
    const period =
      input.granularity === "all"
        ? null
        : resolvePeriod(input.granularity, input.anchor ?? new Date());
    const { items, total } = await ticketRepository.findClosed(
      {
        period: period && { start: period.start, end: period.end },
        limit: input.limit,
        offset: input.offset,
        priority: input.priority,
        q: input.q,
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
            reason: "unknown_category",
            error: `Unknown category "${row.category}"`,
          });
          continue;
        }
        const requester = await ticketRepository.findRequesterByEmail(
          row.requesterEmail,
        );
        // One message for "no such user" and "not yours to file for", on purpose.
        // Telling them apart would turn the import into a directory probe: feed it
        // a list of addresses and the wording says which ones exist in other
        // customers. The row fails either way, so the importer loses nothing.
        if (requester == null || !mayImportForRequester(user, requester)) {
          results.push({
            index,
            ok: false,
            field: "requesterEmail",
            reason: "unknown_requester",
            error: `No user with email "${row.requesterEmail}"`,
          });
          continue;
        }
        const ticket = await ticketRepository.create({
          subject: row.subject,
          description: row.description,
          priority: row.priority,
          categoryId,
          requesterId: requester.id,
          actorId: user.id,
        });
        results.push({ index, ok: true, ticketId: ticket.id });
      } catch (err) {
        results.push({
          index,
          ok: false,
          field: null,
          // Whatever threw is not a case this service names, so the client gets
          // the generic wording. The specific message still rides along in
          // `error` for the logs.
          reason: "create_failed",
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

  /**
   * The requester's half of closing a ticket.
   *
   * A ticket reaches `pending` when the desk says the work is done. Until now
   * only the desk could take it from there, so "closed" was one side's opinion:
   * the person who raised it either agreed in silence or watched the 72h sweep
   * close it over their head. These two actions are the other side of that.
   *
   *   confirm  pending → closed   "yes, this is fixed"
   *   reject   pending → new      "no, it is not" — back to the desk, assignee kept
   *
   * Deliberately NOT a loosening of `PATCH /:id/status`. That endpoint is the
   * desk's, gated on `ticket:write`, and it accepts any legal move; these accept
   * exactly one each, from exactly one status, and only from the person the
   * ticket is about. Widening the general endpoint with a per-row exception would
   * have put "which move is this, and who is asking" into one place that has to
   * get both right every time.
   *
   * Reuses `changeStatus` for the write itself, so the status-history row, the
   * audit entry and the notification to the assignee all happen exactly as they
   * do for a desk-driven move — plus one audit row naming what this was, since
   * "pending → closed" alone cannot say whether a person agreed or a sweep gave up.
   */
  async confirmClosure(id: number, user: AuthUser): Promise<Ticket> {
    const ticket = await this.requireOwnPendingTicket(id, user);
    const closed = await this.changeStatus(ticket.id, "closed", user);
    await auditRepository.record({
      userId: user.id,
      action: "ticket.closure_confirmed",
      entity: "ticket",
      entityId: ticket.id,
      meta: { via: "in_app" },
    });
    return closed;
  },

  /**
   * Reject the closure. The reason is optional but goes in as a public comment
   * rather than a column: it is a message to the person who did the work, it
   * belongs in the thread they will read, and a column would have been a second
   * place to look for the same sentence.
   */
  async rejectClosure(
    id: number,
    reason: string | undefined,
    user: AuthUser,
  ): Promise<Ticket> {
    const ticket = await this.requireOwnPendingTicket(id, user);
    if (reason) {
      await commentService.create(ticket.id, { body: reason, internal: false }, user);
    }
    const reopened = await this.changeStatus(ticket.id, "new", user);
    await auditRepository.record({
      userId: user.id,
      action: "ticket.closure_rejected",
      entity: "ticket",
      entityId: ticket.id,
      meta: { via: "in_app", withReason: Boolean(reason) },
    });
    return reopened;
  },

  /**
   * The gate both closure actions share: this ticket is yours, and it is waiting
   * on you.
   *
   * Keyed on being the REQUESTER of this row, not on a role — an admin who
   * raised their own ticket confirms it the same way anyone else does, and an
   * admin who did not raise it uses the desk's endpoint. 403 rather than 404
   * because `get` has already established that the caller can see the ticket;
   * hiding it a second time would be a lie about which of the two facts failed.
   */
  async requireOwnPendingTicket(id: number, user: AuthUser): Promise<Ticket> {
    const ticket = await this.get(id, user); // row scope → 404 if out of reach
    if (ticket.requesterId !== user.id) {
      throw Forbidden("Only the person who raised a ticket can answer its closure");
    }
    if (ticket.status !== "pending") {
      throw BadRequest(
        `Ticket #${id} is not waiting to be confirmed (it is ${ticket.displayStatus})`,
      );
    }
    return ticket;
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
    // Reopening comes back as `new`, and the assignee is left alone: the person
    // who closed it is the one who knows it, so it returns as their In Progress
    // rather than into the unassigned queue.
    if (ticket.status === "closed" && next === "new" && ticket.closedAt) {
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
    /**
     * The same eligibility check the queue handover makes.
     *
     * This path used to assert only that the id existed, which let one ticket go
     * somewhere a whole queue could not: to a requester, to another customer's
     * staff, and — once accounts could be closed — to someone who had left. Two
     * routes to the same outcome disagreeing about who may hold a ticket is the
     * kind of gap that only shows up as a ticket nobody is working.
     *
     * `null` clears the assignee, which needs no candidate and stays allowed.
     */
    if (assigneeId != null) {
      const candidate = await ticketRepository.findAssignmentCandidate(assigneeId);
      if (!candidate) throw BadRequest(`Unknown user #${assigneeId}`);
      if (!mayReceiveAssignment(user, candidate)) {
        // Deliberately one message, as in `reassign` — distinguishing the reasons
        // would leak the directory of tenants the actor cannot see.
        throw Forbidden(`User #${assigneeId} cannot be assigned tickets`);
      }
    }
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
   * Auto-close tickets left in `pending` for more than 72h — finished work the
   * requester never came back to confirm, which is what pending now means.
   * Runs as a system action (no actor) — reuses updateStatus so a
   * status-history row, audit entry, and notifications are written. Returns the
   * number of tickets actually closed. Invoked by the scheduler in server.ts.
   *
   * A ticket that moves between the scan and its write is skipped, not retried:
   * `updateStatus` compare-and-swaps on `pending`, so it raises a
   * 409 rather than closing a ticket that is open again. That is the right
   * outcome for one ticket and must not abort the sweep for the rest, so each
   * write is isolated and the count reports what really closed.
   */
  async autoCloseStale(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - AUTO_CLOSE_MS);
    const ids = await ticketRepository.findStalePending(cutoff);
    let closed = 0;
    for (const id of ids) {
      try {
        if (await ticketRepository.updateStatus(id, "closed")) closed += 1;
      } catch (err) {
        if (
          err instanceof AppError &&
          (err.code === "CONCURRENT_STATUS_CHANGE" ||
            err.code === "ILLEGAL_TRANSITION")
        ) {
          continue; // moved out of `pending` under us — no longer ours to close
        }
        throw err;
      }
    }
    return closed;
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
