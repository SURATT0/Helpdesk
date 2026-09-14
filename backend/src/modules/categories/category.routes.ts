import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { categoryController } from "./category.controller";

const router = Router();

/**
 * Categories. Behind `requireAuth` at the mount point and scoped in the
 * repository to the caller's own reach.
 *
 * No `requirePermission` on any of these, deliberately, and for two different
 * reasons. The LIST is a picker's data — every requester needs it to file
 * anything at all — so it carries no gate beyond being signed in. The two
 * writes are gated in the SERVICE on `category:write`, a permission held by no
 * role explicitly so only super_admin's `*` satisfies it; that is the same
 * arrangement `project:delete` uses, and it lives in the service because the
 * reach check it sits beside needs the request's own customerId.
 */
router.get("/", asyncHandler(categoryController.list));
// Declared before the bare "/" POST for readability only — different methods
// and different paths, so nothing collides.
router.get("/other-descriptions", asyncHandler(categoryController.otherDescriptions));
router.post("/", asyncHandler(categoryController.create));

export const categoryRoutes = router;
