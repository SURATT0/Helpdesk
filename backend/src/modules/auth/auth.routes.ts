import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { requireAuth } from "../../middlewares/auth";
import { env } from "../../config/env";
import { authController } from "./auth.controller";
import { createLoginLimiter } from "./auth.rate-limit";

const router = Router();

// Brute-force guard on the credential endpoint — per ACCOUNT, not per address.
// See auth.rate-limit.ts for why the address is not usable here.
const loginLimiter = createLoginLimiter(env.authRateLimit);

/**
 * POST /login   — verify credentials, issue access token + httpOnly refresh cookie
 * POST /refresh — rotate the refresh token (reuse of a revoked one nukes the family)
 * POST /logout  — revoke the session family and clear the cookie
 * GET  /me      — current user (requires a valid access token)
 */
router.post("/login", loginLimiter, asyncHandler(authController.login));
router.post("/refresh", asyncHandler(authController.refresh));
router.post("/logout", asyncHandler(authController.logout));
router.get("/me", requireAuth, asyncHandler(authController.me));

export const authRoutes = router;
