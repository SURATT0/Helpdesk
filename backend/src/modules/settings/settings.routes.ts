import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { requirePermission } from "../../middlewares/auth";
import { settingsController } from "./settings.controller";

/**
 * Notification policy, per customer.
 *
 * Every route requires `settings:write` — including the read. This is not a
 * screen for working a case; it is the desk's own configuration, and the people
 * who may look at it are the people who may change it. Which TENANT a holder
 * reaches is decided separately, inside the service, on `customerId`.
 */
const router = Router();

router.get(
  "/notifications",
  requirePermission("settings:write"),
  asyncHandler(settingsController.get),
);
router.put(
  "/notifications",
  requirePermission("settings:write"),
  asyncHandler(settingsController.update),
);
router.delete(
  "/notifications",
  requirePermission("settings:write"),
  asyncHandler(settingsController.reset),
);

export const settingsRoutes = router;
