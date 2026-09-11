import type { NextFunction, Request, Response } from "express";
import { Forbidden, Unauthorized } from "../shared/errors";
import { maySignIn } from "../shared/domain";
import { verifyAccessToken } from "../modules/auth/auth.tokens";

/**
 * Gate a route on a valid access token. Reads `Authorization: Bearer <jwt>`,
 * verifies it, and attaches the principal to `req.user`. Permission-level and
 * row-level checks build on top of this in the RBAC milestone.
 *
 * Also the single place that enforces "an account that may not sign in sees
 * NOTHING". Putting it here rather than on each route is the whole point: every
 * authenticated endpoint in the API — including the dashboard, the reports and
 * the CSV import, which this work is otherwise not allowed to touch — is behind
 * this function, so a `pending` account is refused everywhere at once and no
 * future route has to remember. The check is free: `status` rides the signed
 * token, so this stays a signature check with no database query behind it.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(Unauthorized("Missing bearer token"));
  }
  let user;
  try {
    user = verifyAccessToken(header.slice("Bearer ".length));
  } catch {
    return next(Unauthorized("Invalid or expired token"));
  }
  // 403, not 401: the token is genuine and the caller is who they say. What is
  // wrong is the account, and answering 401 would send the web app into its
  // refresh-and-retry loop against a door that is not going to open.
  if (!maySignIn(user.status)) {
    return next(Forbidden("This account is not active"));
  }
  req.user = user;
  next();
}

/**
 * Require a specific permission on the authenticated principal (admins hold
 * `*`). Must run after requireAuth. Row-level scoping is enforced separately in
 * the repository — this only gates the coarse action.
 */
export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const perms = req.user?.permissions ?? [];
    if (perms.includes("*") || perms.includes(permission)) return next();
    next(Forbidden(`Missing permission: ${permission}`));
  };
}
