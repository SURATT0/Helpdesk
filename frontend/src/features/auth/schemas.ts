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
  /**
   * The language this person reads. In the session payload so the app opens in
   * it on the first paint after signing in, rather than in whatever this
   * particular browser's localStorage happens to remember — which on a shared
   * machine is the last person's choice, not this one's.
   */
  language: z.enum(["en", "th"]),
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
