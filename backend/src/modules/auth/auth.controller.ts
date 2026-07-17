import type { CookieOptions, Request, Response } from "express";
import { env } from "../../config/env";
import { Unauthorized } from "../../shared/errors";
import { authService } from "./auth.service";
import { loginBody } from "./auth.validators";

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
