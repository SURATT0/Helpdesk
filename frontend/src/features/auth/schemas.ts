import { z } from "zod";

export const roleSchema = z.enum(["super_admin", "admin", "user"]);

export const authUserSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  teamId: z.number().nullable(),
  /**
   * Whether routed work currently comes to me. In the session payload because
   * anyone may toggle their own away state — including requesters, who cannot
   * read the user directory to find themselves there.
   */
  availableForAssignment: z.boolean(),
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
