import type { Role } from "@prisma/client";
import { prisma } from "../../shared/db";
import { auditRepository } from "../audit/audit.repository";

export type RoleGrants = Record<Role, string[]>;

/**
 * The live grant table, cached in memory and reloaded when it changes.
 *
 * Why a cache at all: `requireAuth` runs on every authenticated request and used
 * to be a signature check with no database behind it. Reading `role_permissions`
 * per request would put a query in front of every call in the product for a
 * table with three rows' worth of meaning that changes about never.
 *
 * Why not the access token, which already carries the permissions: because a
 * change has to reach a session that is already signed in. A token is minted for
 * fifteen minutes and cannot be edited after the fact, so gating on it would
 * mean an agent kept a permission for a quarter of an hour after it was taken
 * away — which is exactly the window an administrator revoking something is
 * trying to close.
 *
 * The honest limitation, stated where someone will look for it: this cache is
 * per PROCESS. Run two API instances and an edit made on one is invisible to the
 * other until its own cache expires. `CACHE_TTL_MS` is what bounds that, and it
 * is short enough to be a delay rather than a divergence. A deployment that
 * genuinely runs several instances should move this to a shared cache or drop
 * the cache entirely — the rest of the code does not care which, because nothing
 * outside this file reads the table.
 */
const CACHE_TTL_MS = 30_000;

let cache: { grants: RoleGrants; loadedAt: number } | null = null;

/** Drop the cache, so the next read goes to the database. */
export function invalidatePermissionCache(): void {
  cache = null;
}

async function load(): Promise<RoleGrants> {
  const rows = await prisma.rolePermission.findMany({
    select: { role: true, permission: true },
  });
  const grants = { super_admin: [], admin: [], user: [] } as RoleGrants;
  for (const row of rows) grants[row.role].push(row.permission);
  return grants;
}

/** Every role's grants, from the cache when it is warm and fresh. */
export async function currentGrants(): Promise<RoleGrants> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.grants;
  const grants = await load();
  cache = { grants, loadedAt: Date.now() };
  return grants;
}

/** One role's grants. */
export async function grantsFor(role: Role): Promise<string[]> {
  return (await currentGrants())[role] ?? [];
}

/**
 * Replace one role's grants wholesale, and write what changed.
 *
 * Wholesale rather than add/remove calls: the matrix screen submits a row at a
 * time and the question it is answering is "what should this role hold", not
 * "what should change". A diff computed here from the rows actually present is
 * also what makes the audit entry truthful — two administrators editing at once
 * cannot produce an audit line claiming a change that did not happen.
 *
 * In one transaction, so a failure halfway cannot leave a role holding neither
 * the old set nor the new one.
 */
export async function replaceGrants(input: {
  role: Role;
  permissions: string[];
  actorId: number;
}): Promise<{ added: string[]; removed: string[] }> {
  const wanted = [...new Set(input.permissions)].sort();

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.rolePermission.findMany({
      where: { role: input.role },
      select: { permission: true },
    });
    const had = new Set(existing.map((r) => r.permission));
    const want = new Set(wanted);

    const added = wanted.filter((p) => !had.has(p));
    const removed = [...had].filter((p) => !want.has(p)).sort();

    if (removed.length > 0) {
      await tx.rolePermission.deleteMany({
        where: { role: input.role, permission: { in: removed } },
      });
    }
    if (added.length > 0) {
      await tx.rolePermission.createMany({
        data: added.map((permission) => ({
          role: input.role,
          permission,
          grantedById: input.actorId,
        })),
      });
    }
    return { added, removed };
  });

  // Only when something actually moved. An audit trail that records every SAVE
  // rather than every CHANGE is one nobody can read: the line that matters
  // drowns among a hundred saying "set it to what it already was".
  if (result.added.length > 0 || result.removed.length > 0) {
    await auditRepository.record({
      userId: input.actorId,
      action: "permissions.changed",
      entity: "role",
      entityId: null,
      // Before and after, not just the delta. "Removed ticket:write" tells you
      // what happened; the two lists tell you what the role could do on either
      // side of it, which is the question an incident review actually asks.
      meta: {
        role: input.role,
        added: result.added,
        removed: result.removed,
        before: [...had(result, wanted)].sort(),
        after: wanted,
      },
    });
  }

  invalidatePermissionCache();
  return result;
}

/** Reconstruct the prior set from the diff, so the audit can state both sides. */
function had(
  result: { added: string[]; removed: string[] },
  after: string[],
): Set<string> {
  const before = new Set(after);
  for (const p of result.added) before.delete(p);
  for (const p of result.removed) before.add(p);
  return before;
}
