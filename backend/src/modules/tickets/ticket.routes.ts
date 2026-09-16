import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { requirePermission } from "../../middlewares/auth";
import { ticketController } from "./ticket.controller";
import { replyController } from "./reply.controller";

const router = Router();

// requireAuth is applied at the mount point; reads rely on repository row
// scoping, writes additionally require the ticket:write permission.
router.get("/", asyncHandler(ticketController.list));
router.post(
  "/",
  requirePermission("ticket:create"),
  asyncHandler(ticketController.create),
);
router.post(
  "/import",
  requirePermission("ticket:import"),
  asyncHandler(ticketController.importTickets),
);
// The closed-ticket history log. Like /reassign below, declared ahead of the
// `/:id` routes so the literal path is never read as an id. No extra permission:
// it is a ticket read, so repository row scoping is the gate — a requester sees
// their own closed tickets, staff see their customer's.
// Declared ahead of "/closed" so the more specific path wins regardless of how
// Express orders same-prefix routes.
router.get("/closed/periods", asyncHandler(ticketController.closedPeriods));
router.get("/closed", asyncHandler(ticketController.closedHistory));
// Hand one person's queue to another (agent on leave / departed). Declared ahead
// of the `/:id` routes so the literal path is never read as an id, and gated on
// ticket:assign — managers and admins only, unlike single-ticket assignment,
// which any agent may do with ticket:write.
router.post(
  "/reassign",
  requirePermission("ticket:assign"),
  asyncHandler(ticketController.reassign),
);
router.get("/:id", asyncHandler(ticketController.get));
router.get("/:id/history", asyncHandler(ticketController.history));
// Soft-delete a ticket. `ticket:delete` is held by no role explicitly, so only
// super_admin's "*" satisfies it — closing is the normal end of a ticket's life and
// this is the escape hatch for a row that should never have existed. Row scope is
// still enforced in the service, so a customer's own super admin cannot reach
// another tenant's ticket.
router.delete(
  "/:id",
  requirePermission("ticket:delete"),
  asyncHandler(ticketController.remove),
);
router.post(
  "/:id/reply",
  requirePermission("ticket:write"),
  asyncHandler(replyController.send),
);
router.patch(
  "/:id/status",
  requirePermission("ticket:write"),
  asyncHandler(ticketController.updateStatus),
);
router.patch(
  "/:id/assignee",
  requirePermission("ticket:write"),
  asyncHandler(ticketController.updateAssignee),
);
router.patch(
  "/:id/priority",
  requirePermission("ticket:write"),
  asyncHandler(ticketController.updatePriority),
);
/**
 * The requester's half of closing a ticket: confirm the work, or send it back.
 *
 * No `requirePermission`, on purpose. Every other write here is the desk's and
 * rides on `ticket:write`; these two are the requester's, and the right to use
 * them comes from being the person the ticket is about — a fact about the ROW,
 * which a middleware that only sees the role cannot check. The service does it
 * (ticketService.requireOwnPendingTicket) and 403s anyone else, staff included:
 * an admin who did not raise the ticket has the status endpoint above.
 */
router.post("/:id/closure/confirm", asyncHandler(ticketController.confirmClosure));
router.post("/:id/closure/reject", asyncHandler(ticketController.rejectClosure));

/**
 * The requester withdrawing a ticket the desk has not moved yet.
 *
 * No `requirePermission`, for the same reason as the two above: the right comes
 * from being the person who raised the row. `ticketService.cancelOwn` checks it.
 *
 * Its own endpoint rather than a value the desk's `PATCH /:id/status` accepts,
 * and that is what makes "only the requester cancels" enforceable at all: the
 * transition whitelist can say `new → cancelled` is a legal MOVE, but it cannot
 * say who may make it. Keeping the move off the desk's endpoint is the answer —
 * an agent who wants a ticket gone has `closed`, which says the true thing.
 */
router.post("/:id/cancel", asyncHandler(ticketController.cancel));

/**
 * The requester correcting their own subject and description.
 *
 * No `requirePermission`, for the same reason as the two above: the right comes
 * from being the person who raised the row, which a middleware that only sees a
 * role cannot check. `ticketService.editOwnWording` checks it, and the decision
 * is taken again inside the write's transaction — an agent replying between the
 * check and the save must win.
 *
 * Deliberately not reachable by staff. An agent who wants different words has
 * the thread; rewriting somebody else's account of their own problem is not an
 * edit, it is a different ticket.
 */
router.patch("/:id", asyncHandler(ticketController.editOwn));

// Affected parties are replace-the-whole-set (PUT), which is what a multi-select
// picker produces. Sending an empty array clears the field — both are optional.
router.put(
  "/:id/affected-users",
  requirePermission("ticket:write"),
  asyncHandler(ticketController.setAffectedUsers),
);
router.put(
  "/:id/affected-assets",
  requirePermission("ticket:write"),
  asyncHandler(ticketController.setAffectedAssets),
);

export const ticketRoutes = router;
