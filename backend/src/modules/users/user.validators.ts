import { z } from "zod";

export const userIdParam = z.object({
  id: z.coerce.number().int().positive(),
});

const role = z.enum(["super_admin", "admin", "user"]);

/**
 * Directory filters. Every one of them narrows the caller's SCOPE rather than
 * replacing it — see `userRepository.findMany`. `customerId` in particular is a
 * filter, never a way to look into a tenant you do not reach.
 *
 * The approval queue is `?status=pending`, not an endpoint of its own.
 */
export const listUsersQuery = z.object({
  q: z.string().trim().max(120).optional(),
  role: role.optional(),
  status: z.enum(["pending", "active", "suspended", "rejected"]).optional(),
  customerId: z.coerce.number().int().positive().optional(),
});

/**
 * Approving a registration. Both fields are REQUIRED, and that is the design:
 * approving is choosing which company somebody belongs to and what they may do,
 * and defaulting either would make the most consequential click in the product
 * the one nobody had to think about.
 */
export const approveUserBody = z.object({
  customerId: z.number().int().positive(),
  role,
});

export const rejectUserBody = z.object({
  /**
   * Why, for the audit trail only. Optional, and never mailed to the applicant —
   * a rejection is news a person may want to deliver themselves.
   */
  reason: z.string().trim().max(500).optional(),
});

export const updateUserBody = z
  .object({
    role: role.optional(),
    teamId: z.number().int().positive().nullable().optional(),
    /**
     * Project this user's tickets route through; `null` detaches them. Routing
     * only — it never changes what the user can see.
     */
    projectId: z.number().int().positive().nullable().optional(),
    /** The "ไม่สะดวก" switch: false makes project routing skip this person. */
    availableForAssignment: z.boolean().optional(),
    /**
     * Whether the account may be used at all — false is how someone who has left
     * is retired, since a person who ever raised a ticket cannot be deleted.
     * A different thing from `availableForAssignment`: that one is a rota, this
     * one is the door.
     */
    isActive: z.boolean().optional(),
    /**
     * Suspend an account, or lift a suspension. ONLY those two values.
     *
     * `pending` and `rejected` are deliberately not reachable here: they are
     * states the approval queue owns, and letting a general-purpose patch write
     * them would mean an active account could be pushed back into a queue it has
     * already been through — or marked rejected without the decision ever being
     * made. The approve/reject endpoints are the only way in or out of those.
     */
    status: z.enum(["active", "suspended"]).optional(),
  })
  .refine(
    (d) =>
      d.role !== undefined ||
      d.teamId !== undefined ||
      d.projectId !== undefined ||
      d.availableForAssignment !== undefined ||
      d.isActive !== undefined ||
      d.status !== undefined,
    { message: "Nothing to update" },
  );

// Self-service profile edit (any authenticated user, on their own account).
// Availability is here as well as on the admin path on purpose: marking yourself
// unavailable is the normal way to say "I'm out", and needs no manager.
export const updateProfileBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    availableForAssignment: z.boolean().optional(),
    /**
     * Which language this person is written to in. Self-service for the same
     * reason availability is: it is a statement about yourself, and the language
     * a help desk mails you in should not need a manager.
     */
    language: z.enum(["en", "th"]).optional(),
  })
  .refine(
    (d) =>
      d.name !== undefined ||
      d.availableForAssignment !== undefined ||
      d.language !== undefined,
    { message: "Nothing to update" },
  );

/**
 * The full set of customers a member of staff may reach beyond their own.
 *
 * A complete set, not a delta — see `userRepository.setReach`. An empty array
 * is meaningful and allowed: it revokes everything.
 *
 * Capped so one request cannot write an unbounded number of rows, and because
 * the list rides in the access token: reach is resolved at sign time, so a
 * pathological grant would grow every request that principal makes.
 */
export const setReachBody = z.object({
  customerIds: z.array(z.number().int().positive()).max(100),
});
