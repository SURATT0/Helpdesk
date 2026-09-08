import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { customerController } from "./customer.controller";

const router = Router();

/**
 * Tenants. Behind `requireAuth` at the mount point and scoped in the repository
 * to the caller's own reach.
 *
 * No `requirePermission` middleware on any of these, deliberately. The list is
 * a picker's data and open to everyone (it only ever names tenants you already
 * work in). The writes are gated in the SERVICE instead, because two of the
 * three gates cannot be expressed as a permission string: creating keys on the
 * role tier, and archiving keys on a permission only `super_admin`'s wildcard
 * satisfies — which the middleware would also let every wildcard through
 * without recording the refusal against the customer it named.
 */
router.get("/", asyncHandler(customerController.list));
router.get("/:id", asyncHandler(customerController.get));
router.post("/", asyncHandler(customerController.create));
router.patch("/:id", asyncHandler(customerController.rename));
// Read before the destructive call, so the dialog shows the number the guard
// will refuse on. Declared before `/:id` DELETE for readability only — the
// paths do not collide.
router.get("/:id/archive-impact", asyncHandler(customerController.archiveImpact));
router.delete("/:id", asyncHandler(customerController.archive));

export const customerRoutes = router;
