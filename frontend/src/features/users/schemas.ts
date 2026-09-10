import { z } from "zod";

export const userRoleSchema = z.enum(["super_admin", "admin", "user"]);

/** Only `active` may hold a session. See User.status on the server. */
export const userStatusSchema = z.enum([
  "pending",
  "active",
  "suspended",
  "rejected",
]);

export const userSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
  role: userRoleSchema,
  team: z.object({ id: z.number(), name: z.string() }).nullable(),
  /**
   * The customer this person BELONGS to; null for platform staff. Distinct from
   * `reach` below — this is where they are, that is where else they may work.
   */
  customer: z.object({ id: z.number(), name: z.string() }).nullable(),
  /**
   * Routing group this user's new tickets flow through — never a visibility
   * scope. Null means nothing is routed and their tickets land in the queue.
   */
  project: z.object({ id: z.number(), name: z.string() }).nullable(),
  /**
   * False = away, so project routing skips this person in favour of the backup
   * owner. It does not limit what they can see or do.
   */
  availableForAssignment: z.boolean(),
  /**
   * False = the account is closed. They cannot sign in, an open session ends at
   * its next refresh, and no new work routes to them. A different switch from
   * `availableForAssignment` above: that one is a rota, this one is the door.
   */
  isActive: z.boolean(),
  /**
   * Where the account is in its life — a THIRD axis, and the one that decides
   * whether it may sign in at all.
   *
   * Not a rename of `isActive` above and not derivable from it: `pending` has
   * applied and nobody has decided, `rejected` was decided against, `suspended`
   * was let in and then stopped, and `isActive: false` means the person has
   * left. A directory that showed one of these in place of the other would tell
   * an administrator the wrong thing about who is waiting on them.
   */
  status: userStatusSchema,
  /**
   * When the address was proven, or null if never. Shown in the queue, because
   * approving somebody who has not confirmed their address is approving an
   * address nobody has checked belongs to them.
   */
  emailVerifiedAt: z.string().nullable(),
  /**
   * Customers this person may work BEYOND the one they belong to.
   *
   * Only the granted extras: their own customer is not repeated here, so an
   * empty array — which is almost everyone — means "just their own".
   */
  reach: z.array(z.object({ id: z.number(), name: z.string() })),
  /** The language this person has chosen, or null if they never have. */
  language: z.enum(["en", "th"]).nullable(),
  createdAt: z.string(),
});

export const userListSchema = z.object({ data: z.array(userSchema) });
export const userEnvelopeSchema = z.object({ data: userSchema });

export type UserRole = z.infer<typeof userRoleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
export type User = z.infer<typeof userSchema>;

/**
 * What the directory is narrowed by. Every field is optional and absent means
 * "no filter" — the server ANDs these onto the caller's scope, so none of them
 * can widen what comes back.
 */
export type UserFilters = {
  q?: string;
  role?: UserRole;
  status?: UserStatus;
  customerId?: number;
};
