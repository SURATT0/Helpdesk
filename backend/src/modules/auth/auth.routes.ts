import { Router } from "express";
import { asyncHandler } from "../../middlewares";
import { requireAuthDuringPasswordChange } from "../../middlewares/auth";
import { env } from "../../config/env";
import { authController } from "./auth.controller";
import {
  createAccountRequestLimiter,
  createLoginLimiter,
} from "./auth.rate-limit";

const router = Router();

// Brute-force guard on the credential endpoint — per ACCOUNT, not per address.
// See auth.rate-limit.ts for why the address is not usable here.
const loginLimiter = createLoginLimiter(env.authRateLimit);
const registerLimiter = createAccountRequestLimiter(env.registerRateLimit);
const forgotLimiter = createAccountRequestLimiter(env.passwordResetRateLimit);

/**
 * POST /login   — verify credentials, issue access token + httpOnly refresh cookie
 * POST /refresh — rotate the refresh token (reuse of a revoked one nukes the family)
 * POST /logout  — revoke the session family and clear the cookie
 * GET  /me      — current user (requires a valid access token)
 *
 * POST /register         — self sign-up; lands `pending`, mails a confirmation
 * POST /verify-email     — redeem a confirmation link
 * POST /forgot-password  — request a reset link
 * POST /reset-password   — redeem a reset link and set a new password
 * POST /change-password  — replace your own password, knowing the current one
 *
 * The four below are all UNAUTHENTICATED, which is the point of them, and none
 * carries `requireAuth`. What stands in for it: every one of them answers the
 * same thing whatever the address turns out to be (see the controller), the two
 * that accept an address are rate-limited per address, and the two that accept a
 * token treat it as a single-use bearer credential with an expiry.
 *
 * They are POST including the two redemptions, which could have been GET links
 * straight from the mail. Deliberately not: a GET is followed by mail scanners,
 * link previewers and corporate proxies, any of which would burn a single-use
 * token before its owner ever clicked it. The mail links to a page, and the page
 * posts the token.
 */
router.post("/login", loginLimiter, asyncHandler(authController.login));
router.post("/register", registerLimiter, asyncHandler(authController.register));
router.post("/verify-email", asyncHandler(authController.verifyEmail));
router.post(
  "/forgot-password",
  forgotLimiter,
  asyncHandler(authController.forgotPassword),
);
router.post("/reset-password", asyncHandler(authController.resetPassword));
router.post("/refresh", asyncHandler(authController.refresh));
router.post("/logout", asyncHandler(authController.logout));

/*
 * The two routes an account still carrying an administrator's password may
 * reach, and the ONLY two — hence `requireAuthDuringPasswordChange` rather than
 * `requireAuth`, which refuses such an account everywhere.
 *
 * `/me` is on the list because the web app cannot render the change-password
 * form without knowing who is signed in; refusing it would leave the person
 * looking at a shell with no way forward.
 *
 * Rate-limited on the same limiter as sign-in. It takes the current password
 * and answers differently when that password is wrong, which makes it a
 * credential endpoint whatever else it is — and one reachable with a token
 * whose account is otherwise locked out of the API.
 */
router.post(
  "/change-password",
  loginLimiter,
  requireAuthDuringPasswordChange,
  asyncHandler(authController.changePassword),
);
router.get(
  "/me",
  requireAuthDuringPasswordChange,
  asyncHandler(authController.me),
);

export const authRoutes = router;
