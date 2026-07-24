import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { commentController } from "./comment.controller";

// Nested under /tickets/:ticketId/comments (mergeParams exposes :ticketId).
export const ticketCommentRoutes = Router({ mergeParams: true });
ticketCommentRoutes.get("/", asyncHandler(commentController.list));
ticketCommentRoutes.get("/stream", asyncHandler(commentController.stream));
ticketCommentRoutes.post("/typing", asyncHandler(commentController.typing));
ticketCommentRoutes.post("/", asyncHandler(commentController.create));

// Flat /comments/:id for soft-delete.
export const commentRoutes = Router();
commentRoutes.delete("/:id", asyncHandler(commentController.remove));
