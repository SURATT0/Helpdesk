import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { healthController } from "./health.controller";

const router = Router();

router.get("/health", healthController.live); // liveness
router.get("/ready", asyncHandler(healthController.ready)); // readiness (DB)

export const healthRoutes = router;
