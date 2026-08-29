import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { requirePermission } from "../../middlewares/auth";
import { projectController } from "./project.controller";

const router = Router();

// requireAuth is applied at the mount point. Routing projects are management
// structure — who owns a customer's incoming tickets and who covers when they are
// away — so the whole module sits at super_admin level: project:read to see it,
// project:write to change it. Row scoping in the repository still narrows reads to
// the caller's own customer on top of that, so a manager sees only their tenant.
//
// Reads were previously ungated, on the reasoning that routing targets are useful
// context for any agent. That was reversed deliberately: an agent could see the
// owners but never change them, so the page could only raise a question it had no
// way to answer.
router.get(
  "/",
  requirePermission("project:read"),
  asyncHandler(projectController.list),
);
router.get(
  "/:id",
  requirePermission("project:read"),
  asyncHandler(projectController.get),
);
router.post(
  "/",
  requirePermission("project:write"),
  asyncHandler(projectController.create),
);
router.patch(
  "/:id",
  requirePermission("project:write"),
  asyncHandler(projectController.update),
);

/**
 * Deleting a project, and the impact figure its confirmation dialog reads.
 *
 * Neither carries `requirePermission`, deliberately. The gate is
 * `assertMayDelete` in the service, on `project:delete` — a permission held by
 * no role explicitly, so only super_admin's `*` satisfies it, exactly as
 * `ticket:delete` works. It lives in the service because a REFUSED attempt has
 * to be written to the audit trail against the project it named, and middleware
 * that sees only the role has nothing to name. The check still runs before any
 * read, so a caller without it never touches a row.
 *
 * `/:id/deletion-impact` is declared ahead of the bare `/:id` DELETE only for
 * readability — they are different methods and cannot collide.
 */
router.get(
  "/:id/deletion-impact",
  asyncHandler(projectController.deletionImpact),
);
router.delete("/:id", asyncHandler(projectController.remove));

export const projectRoutes = router;
