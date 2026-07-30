import { z } from "zod";

export const ticketStatus = z.enum([
  "new",
  "open",
  "in_progress",
  "pending",
  "resolved",
  "closed",
]);

export const priority = z.enum(["low", "medium", "high", "critical"]);

/**
 * Assignee filter for the ticket list. A numeric id answers "every case this
 * agent is holding"; the literal `none` answers "the unassigned queue". Those
 * are the two questions a workload view asks, and they need to be
 * distinguishable — an absent filter means "don't filter by assignee at all",
 * which is not the same as "assigned to nobody".
 */
export const assigneeFilter = z.union([
  z.literal("none"),
  z.coerce.number().int().positive(),
]);

export const listTicketsQuery = z.object({
  status: ticketStatus.optional(),
  priority: priority.optional(),
  assigneeId: assigneeFilter.optional(),
});

/** Statuses a reassignment touches by default: the work still in flight. */
export const ACTIVE_STATUSES = [
  "new",
  "open",
  "in_progress",
  "pending",
] as const;

/**
 * Hand one person's queue to another — the "agent is on leave / has left" case.
 * `toUserId: null` empties the queue back to unassigned instead of moving it.
 * `statuses` defaults to ACTIVE_STATUSES: resolved and closed tickets are
 * history, and rewriting their assignee would distort who actually handled them.
 */
export const reassignBody = z.object({
  fromUserId: z.number().int().positive(),
  toUserId: z.number().int().positive().nullable(),
  statuses: z.array(ticketStatus).min(1).optional(),
});

export const ticketIdParam = z.object({
  id: z.coerce.number().int().positive(),
});

export const updateStatusBody = z.object({
  status: ticketStatus,
});

export const updateAssigneeBody = z.object({
  assigneeId: z.number().int().positive().nullable(),
});

export const updatePriorityBody = z.object({
  priority,
});

export const createTicketBody = z.object({
  subject: z.string().min(3),
  description: z.string().min(1),
  categoryId: z.coerce.number().int().positive(),
  priority: priority.default("medium"),
});

/**
 * One row of a CSV import. The category is referenced by name and the requester
 * by email — the service resolves both to ids, reporting per-row which failed
 * (unknown category / unknown requester) so the client can offer a fix.
 */
export const importTicketRow = z.object({
  subject: z.string().min(3),
  description: z.string().min(1),
  priority: priority.default("medium"),
  category: z.string().min(1),
  requesterEmail: z.string().email(),
});

export const importTicketsBody = z.object({
  rows: z.array(importTicketRow).min(1).max(500),
});

/**
 * Affected-party bodies. Both are replace-the-set: an empty array is valid and
 * means "nobody/nothing affected" — the fields are optional by design.
 */
export const setAffectedUsersBody = z.object({
  userIds: z.array(z.number().int().positive()).max(50),
});

export const setAffectedAssetsBody = z.object({
  assetIds: z.array(z.number().int().positive()).max(50),
});
