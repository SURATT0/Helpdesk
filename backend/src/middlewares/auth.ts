import type { NextFunction, Request, Response } from "express";
import { Forbidden, Unauthorized } from "../shared/errors";
import { verifyAccessToken } from "../modules/auth/auth.tokens";

/**
 * Gate a route on a valid access token. Reads `Authorization: Bearer <jwt>`,
 * verifies it, and attaches the principal to `req.user`. Permission-level and
 * row-level checks build on top of this in the RBAC milestone.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(Unauthorized("Missing bearer token"));
  }
  try {
    req.user = verifyAccessToken(header.slice("Bearer ".length));
    next();
  } catch {
    next(Unauthorized("Invalid or expired token"));
  }
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
