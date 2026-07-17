import { prisma } from "../../../shared/db";
import { auditRepository } from "../../audit/audit.repository";

export const emailRepository = {
  /**
   * Resolve the category new email tickets should land in: the preferred name
   * (case-insensitive) if it exists, else the first category by id. Null only
   * if the instance has no categories at all.
   */
  async resolveCategoryId(preferredName?: string): Promise<number | null> {
    if (preferredName) {
      const byName = await prisma.category.findFirst({
        where: { name: { equals: preferredName.trim(), mode: "insensitive" } },
        select: { id: true },
      });
      if (byName) return byName.id;
    }
    const first = await prisma.category.findFirst({
      orderBy: { id: "asc" },
      select: { id: true },
    });
    return first?.id ?? null;
  },

  /**
   * Find a user by email, or create a `requester` for an unknown sender. The
   * created user has no password (they never sign in — they only correspond by
   * email), matching the nullable password_hash column.
   */
  async findOrCreateRequester(
    email: string,
    name: string | undefined,
  ): Promise<{ id: number; created: boolean }> {
    const existing = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };

    const created = await prisma.user.create({
      data: {
        name: name?.trim() || email.split("@")[0],
        email: email.toLowerCase(),
        role: "requester",
        passwordHash: null,
      },
      select: { id: true },
    });
    await auditRepository.record({
      userId: null,
      action: "user.create",
      entity: "user",
      entityId: created.id,
      meta: { via: "email", email },
    });
    return { id: created.id, created: true };
  },
};
