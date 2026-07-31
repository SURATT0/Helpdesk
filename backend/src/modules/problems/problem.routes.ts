import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { requirePermission } from "../../middlewares/auth";
import { problemController } from "./problem.controller";

/** GET /api/v1/problems — reads are row-scoped in the repository. */
const router = Router();
router.get("/", asyncHandler(problemController.list));
router.get("/:id", asyncHandler(problemController.get));
// Editing the investigation is desk work (problem:write — agent and up), the
// same grant as linking. Row scope is enforced in the service via the repository.
router.patch(
  "/:id",
  requirePermission("problem:write"),
  asyncHandler(problemController.update),
);
export const problemRoutes = router;

/**
 * Mounted at /api/v1/tickets/:id/problem — linking and converting are staff
 * actions, so they sit behind `problem:write` rather than being open to the
 * requester who raised the ticket.
 */
const ticketRouter = Router({ mergeParams: true });
ticketRouter.post(
  "/",
  requirePermission("problem:write"),
  asyncHandler(problemController.linkOrConvert),
);
ticketRouter.delete(
  "/",
  requirePermission("problem:write"),
  asyncHandler(problemController.unlink),
);
export const ticketProblemRoutes = ticketRouter;
