import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import type { Role } from "../../shared/domain";
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
