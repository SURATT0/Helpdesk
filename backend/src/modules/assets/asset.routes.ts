import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { requirePermission } from "../../middlewares/auth";
import { assetController } from "./asset.controller";

const router = Router();

// The register is the desk's view of the customer's hardware — every asset, with
// the name and email of whoever holds it — so reading it needs `asset:read`, and
// row-level scope in the repository still narrows it to the caller's customer.
//
// It used to be open to any authenticated user, on the grounds that a requester
// browses assets to pick the one their ticket is about. That reason did not hold:
// naming the affected assets is `PUT /tickets/:id/affected-assets`, which requires
// `ticket:write` — so a requester could read the whole register while being unable
// to submit anything it fed. What they do need is already on their own ticket,
// where `affectedAssets` is embedded in the DTO.
router.get(
  "/",
  requirePermission("asset:read"),
  asyncHandler(assetController.list),
);
router.get(
  "/:id",
  requirePermission("asset:read"),
  asyncHandler(assetController.get),
);

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
