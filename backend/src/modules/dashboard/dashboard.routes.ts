import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { requirePermission } from "../../middlewares/auth";
import { dashboardController } from "./dashboard.controller";

const router = Router();

/**
 * GET /api/v1/dashboard/summary — stat cards + chart data, computed from the DB.
 *
 * Same reasoning as the reports router: these are counts across a queue, not a
 * reader's own rows, so they are gated by permission as well as by scope.
 */
router.get(
  "/summary",
  requirePermission("dashboard:read"),
  asyncHandler(dashboardController.summary),
);

export const dashboardRoutes = router;
