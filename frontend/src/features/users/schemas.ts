import { z } from "zod";

export const userRoleSchema = z.enum(["super_admin", "admin", "user"]);

export const userSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
  role: userRoleSchema,
  team: z.object({ id: z.number(), name: z.string() }).nullable(),
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
  createdAt: z.string(),
});

export const userListSchema = z.object({ data: z.array(userSchema) });
export const userEnvelopeSchema = z.object({ data: userSchema });

export type UserRole = z.infer<typeof userRoleSchema>;
export type User = z.infer<typeof userSchema>;
