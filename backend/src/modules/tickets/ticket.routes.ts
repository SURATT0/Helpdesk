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
router.get("/:id", asyncHandler(ticketController.get));
router.get("/:id/history", asyncHandler(ticketController.history));
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
