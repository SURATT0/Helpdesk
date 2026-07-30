import { z } from "zod";

export const userIdParam = z.object({
  id: z.coerce.number().int().positive(),
});

export const updateUserBody = z
  .object({
    role: z.enum(["admin", "manager", "agent", "requester"]).optional(),
    teamId: z.number().int().positive().nullable().optional(),
    /**
     * Project this user's tickets route through; `null` detaches them. Routing
     * only — it never changes what the user can see.
     */
    projectId: z.number().int().positive().nullable().optional(),
    /** The "ไม่สะดวก" switch: false makes project routing skip this person. */
    availableForAssignment: z.boolean().optional(),
  })
  .refine(
    (d) =>
      d.role !== undefined ||
      d.teamId !== undefined ||
      d.projectId !== undefined ||
      d.availableForAssignment !== undefined,
    { message: "Nothing to update" },
  );

// Self-service profile edit (any authenticated user, on their own account).
// Availability is here as well as on the admin path on purpose: marking yourself
// unavailable is the normal way to say "I'm out", and needs no manager.
export const updateProfileBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    availableForAssignment: z.boolean().optional(),
  })
  .refine(
    (d) => d.name !== undefined || d.availableForAssignment !== undefined,
    { message: "Nothing to update" },
  );
