import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { kbController } from "./kb.controller";

const router = Router();

// GET /api/v1/kb?q=&category=  — browse/search articles (+ meta.categories)
router.get("/", asyncHandler(kbController.list));
// GET /api/v1/kb/suggest?q=...  — deflection articles for the create form
router.get("/suggest", asyncHandler(kbController.suggest));
// GET /api/v1/kb/:id  — full article (must come after the literal /suggest)
router.get("/:id", asyncHandler(kbController.get));

export const kbRoutes = router;
