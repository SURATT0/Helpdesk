import { z } from "zod";

export const roleSchema = z.enum(["admin", "manager", "agent", "requester"]);

export const authUserSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  teamId: z.number().nullable(),
});

export const sessionSchema = z.object({
  user: authUserSchema,
  accessToken: z.string(),
  expiresIn: z.number(),
});

export const sessionEnvelope = z.object({ data: sessionSchema });
export const userEnvelope = z.object({ data: authUserSchema });

export type Role = z.infer<typeof roleSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
