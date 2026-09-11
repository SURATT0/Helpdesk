import type { CookieOptions, Request, Response } from "express";
import { env } from "../../config/env";
import { Unauthorized } from "../../shared/errors";
import { authService } from "./auth.service";
import {
  forgotPasswordBody,
  loginBody,
  registerBody,
  resetPasswordBody,
  verifyEmailBody,
} from "./auth.validators";

const REFRESH_COOKIE = "deskly_rt";

// Scoped to the auth routes so the refresh token is only ever sent back to
// /refresh and /logout — never on regular API calls.
function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: env.cookieSecure,
    path: `/api/v1/auth`,
    maxAge: env.refreshTtlSec * 1000,
  };
}

function respondWithSession(res: Response, session: Awaited<ReturnType<typeof authService.login>>) {
  res.cookie(REFRESH_COOKIE, session.refreshToken, refreshCookieOptions());
  res.json({
    data: {
      user: session.user,
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
    },
  });
}

export const authController = {
  async login(req: Request, res: Response) {
    const { email, password } = loginBody.parse(req.body);
    const session = await authService.login(email, password);
    respondWithSession(res, session);
  },

  /**
   * Self-registration.
   *
   * ONE response, for every outcome the service can reach: created, address
   * already taken, address belongs to someone who never registered. The reply
   * says what will happen if the address is usable and nothing about whether it
   * is — which is what stops the public form doubling as a way to ask whether a
   * given person has an account here.
   *
   * 202, not 201: this did not necessarily create anything, and it definitely did
   * not create anything usable — the account is `pending` and cannot sign in.
   * "Accepted" is the honest code for "your request was taken, a person will
   * decide".
   */
  async register(req: Request, res: Response) {
    const body = registerBody.parse(req.body);
    await authService.register(body);
    res.status(202).json({
      data: {
        message:
          "Check your email for a confirmation link. After you confirm, an administrator has to approve the account before you can sign in.",
      },
    });
  },

  async verifyEmail(req: Request, res: Response) {
    const { token } = verifyEmailBody.parse(req.body);
    const result = await authService.verifyEmail(token);
    // The status is returned so the page can say what is still outstanding.
    // Confirming an address does not let anyone in.
    res.json({ data: { status: result.status } });
  },

  /**
   * Begin a password reset.
   *
   * Same single response as `register`, for the same reason and with the same
   * care: this sentence is returned when a link was sent, when the address has
   * no account, when the account has no password to reset, and when it was
   * rejected. `requestPasswordReset` also does its work without being awaited by
   * the mailer, so the four cases do not differ in timing either.
   */
  async forgotPassword(req: Request, res: Response) {
    const { email } = forgotPasswordBody.parse(req.body);
    await authService.requestPasswordReset(email);
    res.json({
      data: {
        message:
          "If that address has an account, a reset link is on its way. Check your inbox.",
      },
    });
  },

  async resetPassword(req: Request, res: Response) {
    const { token, password } = resetPasswordBody.parse(req.body);
    await authService.resetPassword(token, password);
    // Deliberately does NOT sign them in. The reset just revoked every session
    // this account had, and handing back a new one here would undo the half of
    // the guarantee that matters — that whoever prompted the reset is out.
    res.json({
      data: {
        message:
          "Your password has been changed and every other session was signed out. Sign in with your new password.",
      },
    });
  },

  async refresh(req: Request, res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) throw Unauthorized("No session");
    const session = await authService.refresh(raw);
    respondWithSession(res, session);
  },

  async logout(req: Request, res: Response) {
    await authService.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: `/api/v1/auth` });
    res.json({ data: { ok: true } });
  },

  async me(req: Request, res: Response) {
    if (!req.user) throw Unauthorized(); // requireAuth should guarantee this
    const user = await authService.me(req.user.id);
    res.json({ data: user });
  },
};
