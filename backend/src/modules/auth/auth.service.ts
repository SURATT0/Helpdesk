import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { env } from "../../config/env";
import { Unauthorized } from "../../shared/errors";
import type { Role } from "../../shared/domain";
import { authRepository } from "./auth.repository";
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from "./auth.tokens";

export type PublicUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  teamId: number | null;
};

export type Session = {
  user: PublicUser;
  accessToken: string;
  expiresIn: number;
  /** Raw refresh token — the controller puts this in an httpOnly cookie. */
  refreshToken: string;
};

type UserRow = {
  id: number;
  name: string;
  email: string;
  role: Role;
  teamId: number | null;
  passwordHash: string | null;
  team: { department: string } | null;
};

function toPublicUser(u: UserRow): PublicUser {
  return { id: u.id, name: u.name, email: u.email, role: u.role, teamId: u.teamId };
}

/** Sign an access token and mint + persist a fresh refresh token in a family. */
async function mintSession(user: UserRow, familyId: string): Promise<Session> {
  const refreshToken = generateRefreshToken();
  await authRepository.createRefreshToken({
    userId: user.id,
    familyId,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: new Date(Date.now() + env.refreshTtlSec * 1000),
  });
  return {
    user: toPublicUser(user),
    accessToken: signAccessToken({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      teamId: user.teamId,
      department: user.team?.department ?? null,
    }),
    expiresIn: env.accessTtlSec,
    refreshToken,
  };
}

export const authService = {
  async login(email: string, password: string): Promise<Session> {
    const user = await authRepository.findUserByEmail(email);
    // Uniform error + always-compare guards against user enumeration / timing.
    const hash = user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinva";
    const ok = await bcrypt.compare(password, hash);
    if (!user || !user.passwordHash || !ok) {
      throw Unauthorized("Invalid email or password");
    }
    await authRepository.deleteExpired(user.id); // opportunistic cleanup
    return mintSession(user, randomUUID());
  },

  async refresh(rawToken: string): Promise<Session> {
    const row = await authRepository.findRefreshToken(hashRefreshToken(rawToken));
    if (!row) throw Unauthorized("Invalid session");

    if (row.revokedAt) {
      // An already-rotated (revoked) token was replayed → compromise the whole
      // family and force a fresh login.
      await authRepository.revokeFamily(row.familyId);
      throw Unauthorized("Session reuse detected");
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw Unauthorized("Session expired");
    }

    await authRepository.revokeRefreshToken(row.id); // rotate
    return mintSession(row.user, row.familyId);
  },

  async logout(rawToken?: string): Promise<void> {
    if (!rawToken) return;
    const row = await authRepository.findRefreshToken(hashRefreshToken(rawToken));
    if (row) await authRepository.revokeFamily(row.familyId);
  },

  async me(userId: number): Promise<PublicUser> {
    const user = await authRepository.findUserById(userId);
    if (!user) throw Unauthorized("Session expired");
    return toPublicUser(user);
  },
};
