import { z } from "zod";

export const userRoleSchema = z.enum([
  "admin",
  "manager",
  "agent",
  "requester",
]);

export const userSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
  role: userRoleSchema,
  team: z.object({ id: z.number(), name: z.string() }).nullable(),
  createdAt: z.string(),
});

export const userListSchema = z.object({ data: z.array(userSchema) });
export const userEnvelopeSchema = z.object({ data: userSchema });

export type UserRole = z.infer<typeof userRoleSchema>;
export type User = z.infer<typeof userSchema>;
