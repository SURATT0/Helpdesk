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

export const userRoutes = router;
