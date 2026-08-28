import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { reportsController } from "./reports.controller";

const router = Router();

/** GET /api/v1/reports/sla-summary — SLA compliance + resolution metrics from the DB. */
router.get("/sla-summary", asyncHandler(reportsController.slaSummary));

/**
 * The workload reads, split by who they are about.
 *
 * No `requirePermission` on either, deliberately. A permission string cannot
 * express this gate: `super_admin` holds `*`, so any grant name would be
 * satisfied by the wildcard AND by nothing else, which is the same as checking
 * the role — except spread over a middleware and a grant table instead of said
 * once. The decision lives in `maySeeTeamWorkload` / `maySeeWorkloadOf`
 * (shared/auth) and is applied in the service, where the requested assignee is
 * actually known.
 *
 * `/workload/agents` is declared first so the literal path is never read as a
 * query on `/workload`.
 */
router.get("/workload/agents", asyncHandler(reportsController.agentWorkload));
router.get("/workload", asyncHandler(reportsController.workload));

export const reportsRoutes = router;
