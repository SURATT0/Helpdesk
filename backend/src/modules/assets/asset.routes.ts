import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { requirePermission } from "../../middlewares/auth";
import { assetController } from "./asset.controller";

const router = Router();

// Reads are open to any authenticated user and gated by row-level scope in the
// repository (same stance as tickets) — a requester needs to browse assets to
// pick the one affected by their ticket. Writes are staff-only.
router.get("/", asyncHandler(assetController.list));
router.get("/:id", asyncHandler(assetController.get));

router.post(
  "/",
  requirePermission("asset:write"),
  asyncHandler(assetController.create),
);
router.patch(
  "/:id",
  requirePermission("asset:write"),
  asyncHandler(assetController.update),
);
// Retire, not delete: assets stay resolvable for the tickets that reference them.
router.post(
  "/:id/retire",
  requirePermission("asset:write"),
  asyncHandler(assetController.retire),
);

export const assetRoutes = router;
