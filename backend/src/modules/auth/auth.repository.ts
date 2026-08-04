import { prisma } from "../../shared/db";

/**
 * Data access for auth. Like every repository, this is the only auth layer that
 * touches Prisma — the service works through these methods.
 */
export const authRepository = {
  findUserByEmail(email: string) {
    return prisma.user.findUnique({ where: { email }, include: { team: true } });
  },

  findUserById(id: number) {
    return prisma.user.findUnique({ where: { id }, include: { team: true } });
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
      include: { user: { include: { team: true } } },
    });
  },

  revokeRefreshToken(id: number) {
    return prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
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
};
