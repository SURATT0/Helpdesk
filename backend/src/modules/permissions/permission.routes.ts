import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { permissionController } from "./permission.controller";

const router = Router();

/**
 * The role × permission matrix: readable by anyone signed in, writable with
 * `permission:write`.
 *
 * The WRITE is gated in the SERVICE rather than by `requirePermission` here,
 * because a refusal is part of what that endpoint does and middleware that sees
 * only the role has nothing to say about it.
 *
 * The READ used to carry the same gate, on the grounds that the people who may
 * look at the shape of the desk's trust are the people who may change it. It
 * does not any more: `/permissions` on the web app sets out what each role may
 * do, every user can open it, and with nothing live to read it was rendering a
 * hard-coded copy of a fresh install's grants — which is the same disclosure,
 * only wrong. See `permissionService.matrix`.
 */
router.get("/matrix", asyncHandler(permissionController.matrix));
router.put("/matrix", asyncHandler(permissionController.setGrants));

export const permissionRoutes = router;
