import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { serviceCatalogController } from "./service-catalog.controller";

const router = Router();

/**
 * The catalog behind the ticket list's service filter — not tenant-scoped
 * (a service is global, unlike a category), so no row scoping applies here,
 * only `requireAuth` at the mount point.
 */
router.get("/", asyncHandler(serviceCatalogController.list));

export const serviceCatalogRoutes = router;
