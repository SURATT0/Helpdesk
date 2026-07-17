import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { reportsController } from "./reports.controller";

const router = Router();

/** GET /api/v1/reports/sla-summary — SLA compliance + resolution metrics from the DB. */
router.get("/sla-summary", asyncHandler(reportsController.slaSummary));

export const reportsRoutes = router;
