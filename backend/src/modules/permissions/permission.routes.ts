import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { permissionController } from "./permission.controller";

const router = Router();

/**
 * The role × permission matrix.
 *
 * Both routes are gated in the SERVICE on `permission:write`, not by
 * `requirePermission` here, and deliberately: the read needs the same grant as
 * the write, and a middleware pair saying so twice is a place for the two to
 * drift apart. What each role may do is the shape of the desk's trust — the
 * people who may look at it are the people who may change it.
 *
 * Not to be confused with `/permissions` on the web app, which shows a person
 * what THEY can do and needs no grant at all.
 */
router.get("/matrix", asyncHandler(permissionController.matrix));
router.put("/matrix", asyncHandler(permissionController.setGrants));

export const permissionRoutes = router;
