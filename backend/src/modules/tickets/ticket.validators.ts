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

export const listTicketsQuery = z.object({
  status: ticketStatus.optional(),
  priority: priority.optional(),
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
