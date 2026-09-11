import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { requirePermission } from "../../middlewares/auth";
import { userController } from "./user.controller";

const router = Router();

// Self-service profile edit — any authenticated user, own account. Must be
// registered before "/:id" so the literal "me" isn't parsed as an id.
router.patch("/me", asyncHandler(userController.updateMe));

// Directory read for staff (user:read); role/team changes are admin-only.
router.get("/", requirePermission("user:read"), asyncHandler(userController.list));
router.get(
  "/:id",
  requirePermission("user:read"),
  asyncHandler(userController.get),
);
router.patch(
  "/:id",
  requirePermission("user:write"),
  asyncHandler(userController.update),
);

/**
 * Deciding a registration. Behind `user:write` like the patch above, but the
 * gate that matters is in the SERVICE (`mayApproveRegistration`), because it
 * keys on reach rather than on a permission string — `super_admin` holds the
 * `*` wildcard, which any grant string would satisfy. Same reasoning as
 * `PUT /:id/reach` below.
 *
 * Its own endpoints rather than fields on the patch, and for the same reason
 * reach has its own: approving writes `customerId`, which the patch deliberately
 * cannot touch. Folding it in would hand every `user:write` holder the power to
 * move an existing person between tenants.
 */
router.post(
  "/:id/approve",
  requirePermission("user:write"),
  asyncHandler(userController.approve),
);
router.post(
  "/:id/reject",
  requirePermission("user:write"),
  asyncHandler(userController.reject),
);

// Which customers this person may work beyond their own. Deliberately its own
// endpoint rather than a field on PATCH /:id — `user:write` is held by every
// admin, and this is platform-wide only. Keeping it separate means the stricter
// gate is the whole route, and no future field added to the patch body can
// accidentally travel through the looser one.
//
// The gate itself is in the service (`mayGrantReach`), not middleware, because
// it keys on reach rather than on a permission string, and `super_admin` holds
// the `*` wildcard that any grant string would satisfy.
router.put(
  "/:id/reach",
  requirePermission("user:write"),
  asyncHandler(userController.setReach),
);

export const userRoutes = router;
