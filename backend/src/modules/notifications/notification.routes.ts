import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { notificationController } from "./notification.controller";

const router = Router();

router.get("/", asyncHandler(notificationController.list));
router.get("/stream", asyncHandler(notificationController.stream));
router.post("/read-all", asyncHandler(notificationController.markAllRead));
router.post("/:id/read", asyncHandler(notificationController.markRead));

export const notificationRoutes = router;
