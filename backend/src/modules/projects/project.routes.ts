import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { requirePermission } from "../../middlewares/auth";
import { projectController } from "./project.controller";

const router = Router();

// requireAuth is applied at the mount point. Reads rely on repository row
// scoping (any staff member may see their customer's projects, since routing
// targets are useful context); deciding who owns a project is management work,
// so writes need project:write — managers and admins only.
router.get("/", asyncHandler(projectController.list));
router.get("/:id", asyncHandler(projectController.get));
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
