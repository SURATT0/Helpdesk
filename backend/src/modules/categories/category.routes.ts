import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { categoryController } from "./category.controller";

const router = Router();

/** GET /api/v1/categories — list categories (for the create-ticket form). */
router.get("/", asyncHandler(categoryController.list));

export const categoryRoutes = router;
