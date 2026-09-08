import { z } from "zod";

export const userIdParam = z.object({
  id: z.coerce.number().int().positive(),
});

export const updateUserBody = z
  .object({
    role: z.enum(["super_admin", "admin", "user"]).optional(),
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
  })
  .refine(
    (d) =>
      d.role !== undefined ||
      d.teamId !== undefined ||
      d.projectId !== undefined ||
      d.availableForAssignment !== undefined ||
      d.isActive !== undefined,
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
