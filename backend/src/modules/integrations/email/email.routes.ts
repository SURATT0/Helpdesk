import { Router } from "express";
import { asyncHandler } from "../../../middlewares";
import { emailController } from "./email.controller";

/**
 * Public inbound-email webhook. Mounted WITHOUT requireAuth — it is called by an
 * external email provider, not a logged-in user, and authenticates via the
 * shared EMAIL_WEBHOOK_SECRET (header `x-webhook-secret` or `?secret=`).
 */
const router = Router();
router.post("/", asyncHandler(emailController.inbound));
export const emailWebhookRoutes = router;
