import type { NextFunction, Request, Response } from "express";
import {
  AccountNotActive,
  MissingPermission,
  PasswordChangeRequired,
  SessionExpired,
} from "../shared/errors";
import { maySignIn } from "../shared/domain";
import { verifyAccessToken } from "../modules/auth/auth.tokens";
import { grantsFor } from "../modules/permissions/permission.repository";

/**
 * Gate a route on a valid access token. Reads `Authorization: Bearer <jwt>`,
 * verifies it, and attaches the principal to `req.user`.
 *
 * Also the single place that enforces "an account that may not sign in sees
 * NOTHING". Putting it here rather than on each route is the whole point: every
 * authenticated endpoint in the API — including the dashboard, the reports and
 * the CSV import, which this work is otherwise not allowed to touch — is behind
 * this function, so a `pending` account is refused everywhere at once and no
 * future route has to remember.
 *
 * **The permissions on the token are replaced with the live ones.** This is the
 * change that makes an edit to the matrix reach a session that is already signed
 * in. A token is minted for fifteen minutes and cannot be edited afterwards, so
 * a gate that read it would leave an agent holding a permission for a quarter of
 * an hour after it was taken away — which is precisely the window an
 * administrator revoking something is trying to close. Replacing them here means
 * every downstream check, middleware and service alike, sees the current answer
 * without any of them knowing where it came from.
 *
 * The token still carries a `permissions` claim. It is now advisory — a record
 * of what the role held when the session started — and nothing reads it for a
 * decision.
 *
 * This is no longer free: it consults `grantsFor`, which is a per-process cache
 * over a table that changes about never (see permission.repository). The status
 * check above it still costs nothing.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  return authenticate(req, res, next, { allowUnchangedPassword: false });
}

/**
 * `requireAuth`, minus the handed-over-password gate.
 *
 * For the two routes an account holding an administrator's password must still
 * reach: the form that replaces it, and the `/me` the web app needs in order to
 * render that form. Every other route goes through `requireAuth` and is refused,
 * which is the point — see the gate below.
 *
 * Deliberately a second exported entry point rather than a path allow-list read
 * inside the gate. A list would have to be kept in step with the router from a
 * file that cannot see it, and getting it wrong in the lax direction fails
 * silently: the route keeps working and the gate quietly stops covering it.
 * Naming the exemption at the route makes it visible in the one file where
 * somebody adding a route is already looking.
 */
export async function requireAuthDuringPasswordChange(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  return authenticate(req, res, next, { allowUnchangedPassword: true });
}

async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
  opts: { allowUnchangedPassword: boolean },
) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(SessionExpired("Missing bearer token"));
  }
  let user;
  try {
    user = verifyAccessToken(header.slice("Bearer ".length));
  } catch {
    return next(SessionExpired("Invalid or expired token"));
  }
  // 403, not 401: the token is genuine and the caller is who they say. What is
  // wrong is the account, and answering 401 would send the web app into its
  // refresh-and-retry loop against a door that is not going to open.
  if (!maySignIn(user.status)) {
    return next(AccountNotActive());
  }
  /*
   * An account still carrying the password an administrator chose for it sees
   * nothing but the way to replace it.
   *
   * Here rather than on the routes for the same reason the status gate above is:
   * the borrowed password has been read aloud, pasted into a chat, or written on
   * a note, and "everything except the routes somebody remembered to protect" is
   * not a boundary. One `mustChangePassword` on the token closes the whole API,
   * and the next route added is behind it without its author doing anything.
   *
   * It costs the account nothing it is entitled to: the two exemptions are the
   * change itself and reading its own identity.
   */
  if (user.mustChangePassword && !opts.allowUnchangedPassword) {
    return next(PasswordChangeRequired());
  }

  try {
    user.permissions = await grantsFor(user.role);
  } catch (err) {
    // The grant table is unreachable. Refuse rather than fall back to the
    // token's claim: falling back would mean a database outage quietly restores
    // permissions somebody deliberately revoked, and "the gate opens when the
    // database is down" is the wrong direction for a gate to fail in.
    return next(err);
  }

  req.user = user;
  next();
}

/**
 * Require a specific permission on the authenticated principal. Must run after
 * requireAuth, which is what puts the live grants on `req.user`. Row-level
 * scoping is enforced separately in the repository — this only gates the coarse
 * action.
 *
 * `*` is still honoured and nothing grants it any more: `super_admin` holds an
 * explicit list since the grants became editable, because a wildcard cannot be
 * un-ticked on a matrix. The check stays so a deployment mid-migration, or a row
 * somebody adds by hand, behaves the way it reads.
 */
export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const perms = req.user?.permissions ?? [];
    if (perms.includes("*") || perms.includes(permission)) return next();
    next(MissingPermission(permission));
  };
}
