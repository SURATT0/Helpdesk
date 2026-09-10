import { z } from "zod";

export const projectIdParam = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * Owner slots are `nullable().optional()` on purpose, and the two mean different
 * things: omitted leaves the slot as it is, explicit `null` clears it.
 */
const ownerSlot = z.number().int().positive().nullable().optional();

/**
 * What the project IS, in markdown — scope, contacts, the standing arrangement.
 *
 * Bounded because it is free text somebody types into a form, not because a
 * project description is naturally short: 20k characters is several pages, which
 * is more than anyone writes and far less than a paste of a whole document.
 *
 * `nullable().optional()` carries the same distinction as the owner slots above:
 * omitted leaves it alone, explicit `null` clears it. Rendered as markdown on
 * the project page, so it is stored exactly as typed and never pre-escaped here
 * — escaping on the way IN would double-escape on the way out.
 */
const description = z.string().trim().max(20_000).nullable().optional();

export const createProjectBody = z.object({
  name: z.string().trim().min(1).max(80),
  description,
  /**
   * Only meaningful for a platform admin, who has no customer of their own. A
   * scoped actor's own customer always wins — see resolveProjectCustomerId.
   */
  customerId: z.number().int().positive().optional(),
  ownerId: ownerSlot,
  backupOwnerId: ownerSlot,
});

export const updateProjectBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description,
    ownerId: ownerSlot,
    backupOwnerId: ownerSlot,
  })
  .refine(
    (d) =>
      d.name !== undefined ||
      d.description !== undefined ||
      d.ownerId !== undefined ||
      d.backupOwnerId !== undefined,
    { message: "Nothing to update" },
  );
