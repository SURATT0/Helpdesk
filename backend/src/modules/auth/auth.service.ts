import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { env } from "../../config/env";
import { Unauthorized } from "../../shared/errors";
import type { Role } from "../../shared/domain";
import type { Lang } from "../../shared/i18n";
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
  /**
   * Whether routed work is currently sent to this person. Part of the session
   * payload because every user may toggle their own away state, including
   * requesters, who hold no `user:read` permission and so cannot find themselves
   * in the user directory.
   */
  availableForAssignment: boolean;
  /**
   * The language this person has CHOSEN, or null if they never have.
   *
   * In the session payload so the web app can open in their language on the
   * first paint rather than in whatever this browser's localStorage remembers —
   * on a shared machine that is the previous person's choice, not this one's.
   * Null is passed through rather than defaulted here: the client's fallback
   * (English) is not the mailer's (Thai), so the decision belongs to each of
   * them and not to this DTO.
   */
  language: Lang | null;
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
  customerId: number | null;
  passwordHash: string | null;
  availableForAssignment: boolean;
  isActive: boolean;
  language: Lang | null;
  team: { department: string } | null;
};

/**
 * A deactivated account cannot start or continue a session.
 *
 * Named apart from the credential failure on purpose. It is only ever reached
 * *after* the password has already been verified (or a valid refresh cookie
 * presented), so saying what is actually wrong tells an attacker nothing they did
 * not already have — and telling a real person "invalid email or password" when
 * their password is fine sends them to reset it, twice, before they call anyone.
 */
const Deactivated = () =>
  Unauthorized("This account has been deactivated — contact your administrator");

function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    teamId: u.teamId,
    availableForAssignment: u.availableForAssignment,
    language: u.language,
  };
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
      customerId: user.customerId,
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
    // Checked after the compare, so a wrong password still answers uniformly and
    // the door being shut is not something you can probe for.
    if (!user.isActive) throw Deactivated();
    await authRepository.deleteExpired(user.id); // opportunistic cleanup
    return mintSession(user, randomUUID());
  },

  async refresh(rawToken: string): Promise<Session> {
    const row = await authRepository.findRefreshToken(hashRefreshToken(rawToken));
    if (!row) throw Unauthorized("Invalid session");

    /**
     * Deactivation has to bite here, not only at the next login. The refresh
     * cookie lives seven days and is what keeps a tab signed in indefinitely, so
     * a check only on the password path would leave a departed employee working
     * until their browser happened to close.
     *
     * The whole family goes with it. Leaving the cookie merely refused would let
     * the client retry it every fifteen minutes forever; revoking makes the
     * session end once, and stays correct if the account is ever switched back on.
     */
    if (!row.user.isActive) {
      await authRepository.revokeFamily(row.familyId);
      throw Deactivated();
    }

    if (row.revokedAt) {
      // An already-revoked token came back. Usually that IS theft — but not always:
      // two page loads (or two tabs) whose access tokens expired together both
      // refresh with the same cookie, and the second arrives milliseconds after the
      // first rotated it. Treating that as compromise logs an innocent user out and
      // kills the family, which is what made the E2E suite flaky under load.
      //
      // So a replay is served ONLY when both hold:
      //   - it lands inside the leeway after the rotation, and
      //   - the family still has a live token, i.e. a successor was minted.
      // The second condition is what keeps logout final: logout revokes every token
      // in the family, leaving none live, so a replay after it is still refused.
      const revokedMsAgo = Date.now() - row.revokedAt.getTime();
      const withinLeeway =
        env.refreshReuseLeewaySec > 0 &&
        revokedMsAgo <= env.refreshReuseLeewaySec * 1000;

      if (withinLeeway && (await authRepository.hasLiveToken(row.familyId))) {
        // A racing retry, not a replay attack: mint into the same family and leave
        // reuse detection armed for anything outside the window.
        return mintSession(row.user, row.familyId);
      }

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
    // A still-valid access token outlives deactivation by up to its 15 minutes.
    // This is what stops the app rendering for someone already shut out.
    if (!user.isActive) throw Deactivated();
    return toPublicUser(user);
  },

  /**
   * Delete every past-expiry refresh token, table-wide. Returns the number removed.
   *
   * The login-time cleanup above cannot bound this table on its own: it only ever
   * touches the user doing the logging in, so rows belonging to accounts that stop
   * signing in — a departed employee, a test fixture, a service account used once —
   * stay forever. Expired rows grant nothing (refresh checks `expiresAt`), so this
   * is housekeeping rather than a security fix; what it protects is the table.
   */
  async sweepExpiredSessions(): Promise<number> {
    const { count } = await authRepository.deleteExpiredEverywhere();
    return count;
  },
};
