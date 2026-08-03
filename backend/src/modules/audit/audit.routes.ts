import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { requirePermission } from "../../middlewares/auth";
import { auditController } from "./audit.controller";

/**
 * GET /api/v1/audit — the compliance trail. Read-only by design: there is no
 * POST/PATCH/DELETE here, because audit rows are written only from inside the
 * transaction of the mutation they describe and are never edited afterwards.
 *
 * `audit:read` is granted to managers and admins; which ROWS each sees is
 * decided by `auditScopeWhere` in the repository, not by this gate.
 */
const router = Router();
router.get(
  "/actions",
  requirePermission("audit:read"),
  asyncHandler(auditController.actions),
);
router.get(
  "/",
  requirePermission("audit:read"),
  asyncHandler(auditController.list),
);

export const auditRoutes = router;
