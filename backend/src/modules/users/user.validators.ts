import { z } from "zod";

export const userIdParam = z.object({
  id: z.coerce.number().int().positive(),
});

export const updateUserBody = z
  .object({
    role: z.enum(["admin", "manager", "agent", "requester"]).optional(),
    teamId: z.number().int().positive().nullable().optional(),
  })
  .refine((d) => d.role !== undefined || d.teamId !== undefined, {
    message: "Nothing to update",
  });

// Self-service profile edit (any authenticated user, on their own account).
export const updateProfileBody = z.object({
  name: z.string().trim().min(1).max(80),
});
