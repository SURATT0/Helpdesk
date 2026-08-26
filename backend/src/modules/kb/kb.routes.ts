import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { requirePermission } from "../../middlewares/auth";
import { kbController } from "./kb.controller";

const router = Router();

// requireAuth is applied at the mount point. Reading the knowledge base needs no
// permission — it is open to every signed-in user, which is the point of having
// one — while writing sits behind `kb:write`, held by admin and above.
//
// An admin authoring articles is the same reasoning as `problem:write`: the
// people who work the cases are the ones who know what the fix was, and an article
// nobody with the knowledge can write is an empty knowledge base. Publishing is
// not separately gated: whoever may write the article may decide it is finished.
//
// Reads are filtered by that same permission rather than gated on it — a reader
// sees published articles, someone who may write also sees drafts.

// GET /api/v1/kb?q=&category=  — browse/search articles (+ meta.categories)
router.get("/", asyncHandler(kbController.list));
// GET /api/v1/kb/suggest?q=...  — deflection articles for the create form
router.get("/suggest", asyncHandler(kbController.suggest));
// GET /api/v1/kb/:id  — full article (must come after the literal /suggest)
router.get("/:id", asyncHandler(kbController.get));

// POST /api/v1/kb  — author a new article (id is assigned server-side)
router.post(
  "/",
  requirePermission("kb:write"),
  asyncHandler(kbController.create),
);
// PATCH /api/v1/kb/:id  — edit, and publish via { status: "published" }
router.patch(
  "/:id",
  requirePermission("kb:write"),
  asyncHandler(kbController.update),
);
// DELETE /api/v1/kb/:id  — retire an article outright (see kbRepository.remove)
router.delete(
  "/:id",
  requirePermission("kb:write"),
  asyncHandler(kbController.remove),
);

export const kbRoutes = router;
