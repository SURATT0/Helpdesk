import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import type { Role, UserStatus } from "../../shared/domain";
import { permissionsFor, type AuthUser } from "../../shared/auth";

/**
 * Token utilities. Access tokens are short-lived signed JWTs (carry identity +
 * role + permissions). Refresh tokens are opaque random strings — only their
 * SHA-256 hash is ever persisted, so a DB leak can't be replayed.
 */
type SignableUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  /** Only `active` may act — see AuthUser.status. */
  status: UserStatus;
  teamId: number | null;
  department: string | null;
  /** Home tenant — what a ticket this person raises is filed under. */
  customerId: number | null;
  /** Every customer they may see into, home included. See `customerReach`. */
  customerIds: number[];
};

export function signAccessToken(user: SignableUser): string {
  return jwt.sign(
    {
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      teamId: user.teamId,
      department: user.department,
      customerId: user.customerId,
      customerIds: user.customerIds,
      permissions: permissionsFor(user.role),
    },
    env.jwtAccessSecret,
    { subject: String(user.id), expiresIn: env.accessTtlSec },
  );
}

export function verifyAccessToken(token: string): AuthUser {
  const payload = jwt.verify(token, env.jwtAccessSecret) as jwt.JwtPayload;
  return {
    id: Number(payload.sub),
    name: payload.name as string,
    email: payload.email as string,
    role: payload.role as Role,
    // Absent on a token minted before this claim existed. Those were all issued
    // to accounts that could sign in, which is exactly what `active` means, so
    // defaulting keeps a token in flight across the deploy working rather than
    // logging everyone out — and no token can carry a status the account did not
    // hold when it was signed, because the claim is inside the signature.
    status: (payload.status as UserStatus | undefined) ?? "active",
    teamId: (payload.teamId as number | null) ?? null,
    department: (payload.department as string | null) ?? null,
    customerId: (payload.customerId as number | null) ?? null,
    // Absent on a token minted before grants existed, and on one minted for
    // someone with no tenant. `customerReach` treats both as "your own customer
    // and nothing more", so a token in flight across the deploy keeps working.
    customerIds: Array.isArray(payload.customerIds)
      ? (payload.customerIds as number[])
      : [],
    permissions: (payload.permissions as string[]) ?? [],
  };
}

/** A fresh opaque refresh token (raw value handed to the client cookie). */
export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** SHA-256 of the raw refresh token — what we store and look up by. */
export function hashRefreshToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * A fresh single-use token for a password reset or an email confirmation — the
 * value that travels in the link.
 *
 * `randomBytes`, not `Math.random` or a uuid: this IS the credential. Anyone
 * holding it can set the password on the account it belongs to, so it has to be
 * unguessable in the cryptographic sense, and 32 bytes is the same strength the
 * refresh token beside it uses.
 *
 * Hex rather than base64url so it survives being pasted, wrapped by a mail
 * client, or hand-typed off a screen without a `+`, `/` or `=` changing meaning
 * somewhere in between.
 */
export function generateUserToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * SHA-256 of a raw user token — what `user_tokens.token_hash` stores.
 *
 * The database never sees the token itself, so a stolen dump contains no working
 * links. Plain SHA-256 with no salt or stretching, deliberately and unlike a
 * password: the input here is 32 random bytes rather than something a person
 * chose, so there is no dictionary to run against it and nothing for bcrypt's
 * cost factor to slow down. It also has to be a deterministic lookup key — the
 * redemption path finds the row BY this hash, which a salted digest cannot do.
 */
export function hashUserToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
