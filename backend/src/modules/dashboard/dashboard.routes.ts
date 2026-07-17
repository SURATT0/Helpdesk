import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { dashboardController } from "./dashboard.controller";

const router = Router();

/** GET /api/v1/dashboard/summary — stat cards + chart data, computed from the DB. */
router.get("/summary", asyncHandler(dashboardController.summary));

export const dashboardRoutes = router;
