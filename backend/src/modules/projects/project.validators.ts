import { z } from "zod";

export const projectIdParam = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * Owner slots are `nullable().optional()` on purpose, and the two mean different
 * things: omitted leaves the slot as it is, explicit `null` clears it.
 */
const ownerSlot = z.number().int().positive().nullable().optional();

export const createProjectBody = z.object({
  name: z.string().trim().min(1).max(80),
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
    ownerId: ownerSlot,
    backupOwnerId: ownerSlot,
  })
  .refine(
    (d) =>
      d.name !== undefined ||
      d.ownerId !== undefined ||
      d.backupOwnerId !== undefined,
    { message: "Nothing to update" },
  );
