import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { requirePermission } from "../../middlewares/auth";
import { reportsController } from "./reports.controller";

const router = Router();

/**
 * GET /api/v1/reports/sla-summary — SLA compliance + resolution metrics from the DB.
 *
 * Permissioned, unlike most reads. The rest of the app gates reads by row scope
 * alone — everyone may see what their scope allows — but a report is an
 * *aggregate* over other people's work, which is a different thing to hand a
 * requester. Row scope still applies underneath; this decides who may ask at all.
 */
router.get(
  "/sla-summary",
  requirePermission("report:read"),
  asyncHandler(reportsController.slaSummary),
);

export const reportsRoutes = router;
