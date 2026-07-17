import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { requirePermission } from "../../middlewares/auth";
import { integrationController } from "./integration.controller";

const router = Router();

// requireAuth is applied at the mount point. Listing sources is a read; running
// a sync creates tickets, so it requires the same permission as CSV import.
router.get("/sources", asyncHandler(integrationController.listSources));
router.post(
  "/sources/:id/sync",
  requirePermission("ticket:import"),
  asyncHandler(integrationController.sync),
);
router.get("/email/status", asyncHandler(integrationController.emailStatus));

export const integrationRoutes = router;
