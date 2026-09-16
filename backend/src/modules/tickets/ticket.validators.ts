import { z } from "zod";
import { DB_STATUSES } from "../../shared/ticket-status";
import { freeText, TEXT_MAX } from "../../shared/text";

/** Any value a ticket may be STORED as. Mirrors `DB_STATUSES`. */
export const ticketStatus = z.enum(DB_STATUSES);

/**
 * What the DESK may set through `PATCH /:id/status` — every stored value except
 * `cancelled`.
 *
 * The one place the two lists differ, and the difference is the rule: cancelling
 * is the requester withdrawing their own request, and it has an endpoint of its
 * own (`POST /:id/cancel`) that checks who is asking. The transition whitelist
 * says `new → cancelled` is a legal MOVE but cannot say who may make it, so this
 * is where "not the desk" is actually enforced — an agent who wants a ticket
 * gone has `closed`, which says the true thing about what happened.
 *
 * `new` is NOT excluded, so the desk can still take a cancelled ticket back
 * (`cancelled → new`) when somebody withdraws the wrong one.
 *
 * Written out rather than derived from `DB_STATUSES` by subtraction — a literal
 * list is what a reader can check against the sentence above it. A test pins it
 * as exactly the stored values minus `cancelled`, so a status added later cannot
 * go silently missing from here.
 */
export const deskSettableStatus = z.enum(["new", "pending", "closed"]);

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

/**
 * The vocabulary a READER filters by — four values, "In Progress" among them.
 * Deliberately not `ticketStatus`: that is what a row may be stored as, and the
 * list is narrowed by what was shown (see `displayStatusWhere`). `open` and
 * `resolved` are not accepted here even while rows still hold them, because
 * nothing renders those words any more, so nothing can ask for them.
 */
export const displayStatus = z.enum([
  "new",
  "in_progress",
  "pending",
  "closed",
  "cancelled",
]);

export const listTicketsQuery = z.object({
  status: displayStatus.optional(),
  priority: priority.optional(),
  assigneeId: assigneeFilter.optional(),
  /** One project's tickets — what the project page lists. See TicketFilter. */
  projectId: z.coerce.number().int().positive().optional(),
});

/**
 * Query for the closed-ticket history log.
 *
 * `granularity` picks the window size and `anchor` is any date inside the wanted
 * window — the client navigates by sending back the `prevAnchor`/`nextAnchor`
 * the server handed it, so calendar arithmetic stays in `history.period.ts`
 * alone and the client never has to know how long a month is. An absent anchor
 * means the period containing now, which is what the page opens on.
 */
/**
 * Which periods the picker should list. No anchor or range: the answer is "every
 * period that holds something", which the server derives from the data itself.
 */
export const closedPeriodsQuery = z.object({
  granularity: z.enum(["week", "month", "year"]).default("month"),
});

export const closedHistoryQuery = z.object({
  /**
   * `all` drops the calendar window entirely: every closed ticket in reach,
   * newest first, paged by limit/offset. It exists because a log you can only
   * read one month at a time cannot be searched — the caller has to guess which
   * month holds the ticket before it can look for it. The bucketed
   * granularities stay for callers that genuinely want one period.
   */
  granularity: z.enum(["all", "week", "month", "year"]).default("month"),
  anchor: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  // Filters for the log's own row. Priority and requester used to be table
  // columns; they narrow the period better than they read as data.
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  // Free text over subject, ticket id and requester (name or email). Trimmed,
  // and an empty string is dropped so "cleared the box" is not a filter that
  // matches nothing.
  q: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

/**
 * Statuses a reassignment touches by default, and the same set that decides
 * whether an account still holds work: everything that is not closed.
 *
 * `new` covers New and In Progress alike. `pending` is in here even though the
 * desk has finished with it — the requester may reject it, and it would come
 * back as `new` on whoever owned it, so it is not history the way a closed
 * ticket is. One list, because "what a handover moves" and "what blocks closing
 * an account" have to be the same set or the documented order (hand over, then
 * close the account) does not actually clear the way.
 */
export const ACTIVE_STATUSES = ["new", "pending"] as const;

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

/**
 * A desk-driven status change.
 *
 * `deskSettableStatus`, not `ticketStatus`: this is the endpoint `cancelled` is
 * deliberately kept off, because withdrawing a request belongs to the person who
 * made it — see that constant.
 *
 * `resolution` is optional HERE and required by the service, which looks
 * contradictory and is not: whether it is required depends on the move, and the
 * move depends on the status the ticket is in right now — which this schema
 * cannot see. Making it required in zod would refuse the requester's reopen and
 * every other move that legitimately carries none; making it optional and
 * checking in `changeStatus`, where both ends of the transition are known, is
 * the only place the real rule can be asked. See `requiresResolution`.
 */
export const updateStatusBody = z.object({
  status: deskSettableStatus,
  resolution: freeText({ max: TEXT_MAX.BODY }).optional(),
});

/**
 * The requester's answer when the desk says a ticket is done.
 *
 * The reason is optional — "it is still broken" is a complete answer — and is
 * bounded like any other typed text. It becomes a public comment on the ticket
 * rather than a column; see ticketService.rejectClosure.
 */
export const rejectClosureBody = z.object({
  reason: freeText({ max: TEXT_MAX.BODY }).optional(),
});

/**
 * The requester withdrawing their own ticket.
 *
 * Same shape as the rejection above, and optional for the same reason: "I do not
 * need this any more" is a complete answer, and a required box is how people are
 * taught to type "n/a" to get past one. What is typed becomes a public comment.
 */
export const cancelTicketBody = z.object({
  reason: freeText({ max: TEXT_MAX.BODY }).optional(),
});

export const updateAssigneeBody = z.object({
  assigneeId: z.number().int().positive().nullable(),
});

export const updatePriorityBody = z.object({
  priority,
});

export const createTicketBody = z.object({
  subject: freeText({ min: 3, max: TEXT_MAX.SUBJECT }),
  description: freeText({ max: TEXT_MAX.BODY }),
  categoryId: z.coerce.number().int().positive(),
  /**
   * What the problem is, for the "Other" category.
   *
   * `min: 0` is load-bearing. With a minimum here, a whitespace-only
   * description is refused by zod as a 400 VALIDATION_ERROR naming a field
   * length — and the one place that decides this rule never runs. The shape is
   * checked here; whether it is REQUIRED is `checkCategoryOther's question, and
   * it has to be reached to answer it.
   */
  categoryOther: freeText({ min: 0, max: TEXT_MAX.BODY }).optional(),
  /**
   * Which project to file this under. Optional here even though the web form
   * asks for it: the same endpoint serves callers with no project to give, and
   * the column is nullable for good reasons (see Ticket.projectId). Making the
   * FORM insist is a rule about that form, not about the API.
   */
  projectId: z.coerce.number().int().positive().nullish(),
  priority: priority.default("medium"),
});

/**
 * The `Idempotency-Key` header, for clients that send one.
 *
 * The value is opaque here: all it has to be is stable across a retry of the
 * same submission and unlikely to collide, which is the client's job — the web
 * app uses a UUID per submission. This only bounds it, so a header cannot smuggle
 * an unbounded (or NUL-bearing) string into a column.
 */
export const idempotencyKeyHeader = freeText({ max: 128 });

/**
 * One row of a CSV import. The category is referenced by name and the requester
 * by email — the service resolves both to ids, reporting per-row which failed
 * (unknown category / unknown requester) so the client can offer a fix.
 */
export const importTicketRow = z.object({
  subject: freeText({ min: 3, max: TEXT_MAX.SUBJECT }),
  description: freeText({ max: TEXT_MAX.BODY }),
  priority: priority.default("medium"),
  category: z.string().min(1),
  requesterEmail: z.string().email(),
  /**
   * A `status` column, if the file has one.
   *
   * Every imported ticket is created as New regardless — the importer files
   * work, it does not decide where that work already got to. The column is
   * validated rather than ignored so a file carrying a status this system
   * retired (`Open`, `Resolved`) is refused with a sentence naming what it
   * could have said, instead of being silently dropped and importing as New
   * while the reader believes otherwise.
   */
  status: z
    .string()
    .trim()
    .optional()
    .refine(
      (v) =>
        v == null ||
        v === "" ||
        (DB_STATUSES as readonly string[]).includes(v.toLowerCase()),
      {
        message:
          "must be one of New, Pending, Closed — imported tickets always start as New",
      },
    ),
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

/**
 * The requester's own edit. Subject and description only.
 *
 * Deliberately not priority or category: both feed `dueAt` through the SLA
 * policy at creation, and letting a requester move their own deadline is a
 * different decision from letting them fix a typo. Same bounds as the create
 * form, so a wording that was acceptable to raise stays acceptable to correct.
 */
export const editOwnTicketBody = z.object({
  subject: freeText({ min: 3, max: TEXT_MAX.SUBJECT }),
  description: freeText({ max: TEXT_MAX.BODY }),
});
