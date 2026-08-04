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

export const projectRoutes = router;
