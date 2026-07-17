import {
  canTransition,
  type Priority,
  type TicketStatus,
} from "../../shared/domain";
import type { AuthUser } from "../../shared/auth";
import {
  IllegalTransition,
  NotFound,
  ReopenWindowExpired,
} from "../../shared/errors";

const DAY_MS = 24 * 60 * 60 * 1000;
const REOPEN_WINDOW_MS = 30 * DAY_MS;
const AUTO_CLOSE_MS = 72 * 60 * 60 * 1000;
import {
  ticketRepository,
  type CreateTicketInput,
  type HistoryEntry,
  type Ticket,
  type TicketFilter,
} from "./ticket.repository";

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
};
