import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { requirePermission } from "../../middlewares/auth";
import { problemController } from "./problem.controller";

const router = Router();

/**
 * The register — every open investigation in the customer — is desk work, so it
 * needs `problem:read`. It powers the "link to an existing problem" picker, which
 * is itself `problem:write`, so nobody who can use the list is refused it.
 *
 * A single problem stays readable without that permission, because a requester is
 * shown the problem their OWN ticket is linked to: it is the answer to "why is my
 * ticket waiting on something bigger", and it carries the workaround. Which
 * problems that reaches is `problemScopeWhere`'s job — for a requester, the ones
 * with a ticket of theirs attached, and nothing else.
 */
router.get(
  "/",
  requirePermission("problem:read"),
  asyncHandler(problemController.list),
);
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
