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
   * The language this person has CHOSEN, or null if they never have.
   *
   * In the session payload so the app opens in their language on the first
   * paint after signing in, rather than in whatever this particular browser's
   * localStorage remembers — which on a shared machine is the last person's
   * choice, not this one's. Null leaves the app on its own default; it does NOT
   * mean Thai, even though that is what the server falls back to for mail.
   */
  language: z.enum(["en", "th"]).nullable(),
  /**
   * Whether I reach every customer, including ones created later.
   *
   * Sent as the ANSWER rather than as the `customerId` it is computed from, on
   * purpose: the rule lives in one function on the server (`isPlatformWide`),
   * and a client that re-derived it would be a second copy nobody would notice
   * drifting. Use it only to decide whether to OFFER a cross-tenant control —
   * every such endpoint checks for itself, and this flag is not the gate.
   *
   * Defaulted so a session restored from an older payload reads as false, which
   * hides the controls rather than showing ones the server will refuse.
   */
  platformWide: z.boolean().default(false),
});

export const sessionSchema = z.object({
  user: authUserSchema,
  accessToken: z.string(),
  expiresIn: z.number(),
});

export const sessionEnvelope = z.object({ data: sessionSchema });
export const userEnvelope = z.object({ data: authUserSchema });

/**
 * Where an account stands. Only `active` may sign in.
 *
 * The web app reads this in exactly one place — the confirmation page, to say
 * what is still outstanding after an address is proven. It is deliberately NOT
 * on `authUserSchema`: a session only ever exists for an `active` account, so a
 * status field there could only ever hold one value and would invite code that
 * branches on a state it can never be in.
 */
export const userStatusSchema = z.enum([
  "pending",
  "active",
  "suspended",
  "rejected",
]);

/**
 * The shape the self-service endpoints answer with: one sentence, written by the
 * server. See the note in api.ts for why the copy lives there and not here.
 */
export const messageEnvelope = z.object({
  data: z.object({ message: z.string() }),
});

export const verifyEmailEnvelope = z.object({
  data: z.object({ status: userStatusSchema }),
});

export type Role = z.infer<typeof roleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
