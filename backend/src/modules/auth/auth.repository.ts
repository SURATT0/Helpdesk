import { prisma } from "../../shared/db";

/**
 * Data access for auth. Like every repository, this is the only auth layer that
 * touches Prisma — the service works through these methods.
 */
/**
 * Cross-tenant grants, loaded with the user on every sign-in and refresh so the
 * access token can carry the reach it was minted with. Ids only — the customer
 * rows themselves are never needed here, and pulling them would make the login
 * query grow with the number of customers someone covers.
 */
const REACH_INCLUDE = {
  reachGrants: { select: { customerId: true } },
} as const;

export const authRepository = {
  findUserByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
      include: { team: true, ...REACH_INCLUDE },
    });
  },

  findUserById(id: number) {
    return prisma.user.findUnique({
      where: { id },
      include: { team: true, ...REACH_INCLUDE },
    });
  },

  createRefreshToken(data: {
    userId: number;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    return prisma.refreshToken.create({ data });
  },

  findRefreshToken(tokenHash: string) {
    return prisma.refreshToken.findUnique({
      where: { tokenHash },
      // Grants load here too: refresh re-mints the access token, so this is the
      // moment a grant added or revoked since sign-in takes effect.
      include: { user: { include: { team: true, ...REACH_INCLUDE } } },
    });
  },

  revokeRefreshToken(id: number) {
    return prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  },

  /**
   * Does this family still hold a usable token?
   *
   * Tells a rotation apart from a logout when an already-revoked token is replayed:
   * rotating mints a successor, so the family still has one live token, while
   * logout revokes them all. Without this check a replay inside the reuse leeway
   * would revive a session the user had deliberately ended.
   */
  async hasLiveToken(familyId: string): Promise<boolean> {
    const live = await prisma.refreshToken.count({
      where: { familyId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    return live > 0;
  },

  /** Revoke every still-live token in a family (logout / reuse detection). */
  revokeFamily(familyId: string) {
    return prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  /**
   * Delete a user's expired refresh tokens to keep the table bounded. Only
   * past-expiry rows are removed — a revoked-but-unexpired token is retained so
   * reuse-detection can still catch a replay within its validity window.
   *
   * Runs on login, so it only ever tidies up after someone who came back. The
   * account that never logs in again is `deleteExpiredEverywhere`'s job.
   */
  deleteExpired(userId: number) {
    return prisma.refreshToken.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });
  },

  /**
   * Same deletion, table-wide: for the sweep, which is the only path that reaches
   * rows belonging to users who never return. Same `expiresAt` cutoff and the same
   * reason for it — a revoked-but-unexpired token must survive so a replay inside
   * its validity window is still caught.
   */
  deleteExpiredEverywhere() {
    return prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  },

  /**
   * Revoke EVERY live session this user holds, across all families.
   *
   * What a successful password reset ends. Rotating the password without this
   * would leave whoever prompted the reset — the reason the owner reset it —
   * signed in on their own device for up to seven days, holding a refresh cookie
   * the new password has no bearing on.
   */
  revokeAllSessions(userId: number) {
    return prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  /**
   * Look up an address for registration, case-insensitively.
   *
   * `findUserByEmail` above is a `findUnique` on the column and so is
   * case-SENSITIVE, which is the right shape for signing in (it matches what was
   * stored). Registration is asking a different question — "is this address
   * already taken" — and `Dana@ACME.com` must not be able to take an address
   * `dana@acme.com` already holds.
   */
  findUserByEmailInsensitive(email: string) {
    return prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, email: true, status: true, passwordHash: true },
    });
  },

  /**
   * Create a self-registered account.
   *
   * `pending` and no customer, both deliberate. Nobody has decided anything
   * about this person yet: not whether they belong here, and not which tenant
   * they belong to — and inventing a customer would file their first ticket
   * under a company that never agreed to have them. The approval step is where
   * both answers are given, together.
   */
  createSelfRegistered(data: {
    name: string;
    email: string;
    passwordHash: string;
  }) {
    return prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash: data.passwordHash,
        role: "user",
        status: "pending",
        customerId: null,
      },
      select: { id: true, name: true, email: true },
    });
  },

  /**
   * Issue a single-use token, invalidating any the user is still holding for the
   * same purpose.
   *
   * Both halves in one transaction. The invalidation is what stops a mailbox
   * accumulating five working reset links, each valid for an hour — asking again
   * has to REPLACE the last answer, or "request another one" quietly widens the
   * window instead of refreshing it.
   */
  async issueUserToken(data: {
    userId: number;
    purpose: "password_reset" | "email_verification";
    tokenHash: string;
    expiresAt: Date;
  }) {
    return prisma.$transaction(async (tx) => {
      await tx.userToken.updateMany({
        where: { userId: data.userId, purpose: data.purpose, usedAt: null },
        data: { usedAt: new Date() },
      });
      return tx.userToken.create({ data, select: { id: true } });
    });
  },

  findUserToken(tokenHash: string) {
    return prisma.userToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, status: true } } },
    });
  },

  /**
   * Redeem a reset token: mark it used, set the new password, and end every
   * session — all or nothing.
   *
   * One transaction because a partial application is a security hole in either
   * direction. Marking the token used without setting the password locks the
   * owner out of their own account; setting the password without revoking leaves
   * the sessions the reset was meant to close still open.
   *
   * `usedAt: null` in the WHERE is what makes it single-use under a race: two
   * requests carrying the same token both pass the service's check, and only one
   * of them matches a row here.
   */
  async redeemPasswordReset(data: {
    tokenId: number;
    userId: number;
    passwordHash: string;
  }): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const claimed = await tx.userToken.updateMany({
        where: { id: data.tokenId, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) return false;
      await tx.user.update({
        where: { id: data.userId },
        data: { passwordHash: data.passwordHash },
      });
      await tx.refreshToken.updateMany({
        where: { userId: data.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return true;
    });
  },

  /**
   * Redeem a verification token: mark it used and stamp the address as proven.
   *
   * Note what this does NOT do — it does not change `status`. Proving the address
   * and being allowed in are two different decisions, and only a person makes
   * the second one.
   */
  async redeemEmailVerification(data: {
    tokenId: number;
    userId: number;
  }): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const claimed = await tx.userToken.updateMany({
        where: { id: data.tokenId, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) return false;
      await tx.user.update({
        where: { id: data.userId },
        data: { emailVerifiedAt: new Date() },
      });
      return true;
    });
  },
};
