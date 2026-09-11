import { z } from "zod";

/**
 * One role's whole grant list.
 *
 * The strings are NOT validated against the catalogue here. That check lives in
 * the service, which can say which unknown permission was sent — a zod enum
 * would answer "invalid enum value" and list all twenty-three valid ones, which
 * is a worse message for the same refusal.
 */
export const setGrantsBody = z.object({
  role: z.enum(["super_admin", "admin", "user"]),
  permissions: z.array(z.string().trim().min(1).max(64)).max(200),
});
