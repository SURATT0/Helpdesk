import { z } from "zod";

/**
 * A caseworker slot on a project. `available` is the "away" flag, surfaced here so
 * an admin screen can show "owner is away — routing to the backup" without a
 * second request.
 */
export const projectOwnerSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    available: z.boolean(),
  })
  .nullable();

export const projectSchema = z.object({
  id: z.number(),
  name: z.string(),
  /**
   * What the project IS, in markdown — scope, contacts, the standing
   * arrangement. Null when nobody has written one, which is every project that
   * predates the field.
   */
  description: z.string().nullable().default(null),
  customerId: z.number(),
  owner: projectOwnerSchema,
  backupOwner: projectOwnerSchema,
  /** How many users route their tickets through this project. */
  members: z.number(),
  createdAt: z.string(),
});

export const projectListSchema = z.object({
  data: z.array(projectSchema),
  meta: z.object({ total: z.number() }),
});

export const projectEnvelopeSchema = z.object({ data: projectSchema });

/**
 * What archiving a project would disturb. Two different things, counted apart.
 *
 * `members` is everyone routing through it — its listed members plus the owner
 * and backup owner. That is what archiving would break about ROUTING.
 *
 * `openTickets` is live work filed under it. This did not exist as a question
 * for most of the product's life: a ticket carried no project, so "tickets in
 * this project" had no answer. `tickets.project_id` changed that, and the guard
 * changed with it.
 *
 * OPEN ones only. A project that ran for a year has hundreds of closed tickets
 * pointing at it and archiving strands none of them — their name still renders,
 * because the ticket reads the project row without filtering archived ones.
 * Counting those too would mean a routing project could never be retired.
 *
 * Two numbers rather than a total, because the fixes differ: members are moved
 * to another project, tickets are finished or re-filed.
 */
export const projectDeletionImpactSchema = z.object({
  data: z.object({
    id: z.number(),
    name: z.string(),
    customerId: z.number(),
    members: z.number(),
    // Defaulted so a response from an API that predates the field still parses.
    openTickets: z.number().default(0),
  }),
});

export type ProjectDeletionImpact = z.infer<
  typeof projectDeletionImpactSchema
>["data"];

export type Project = z.infer<typeof projectSchema>;
export type ProjectOwner = z.infer<typeof projectOwnerSchema>;

export type CreateProjectInput = {
  name: string;
  /** Markdown, shown on the project page. Optional — a project may have none. */
  description?: string | null;
  /** Platform admins only — scoped staff always create in their own customer. */
  customerId?: number;
  ownerId?: number | null;
  backupOwnerId?: number | null;
};

/**
 * Omitting a field leaves it alone; passing `null` for an owner slot clears it.
 * The two are deliberately different, so don't collapse undefined into null.
 */
export type UpdateProjectInput = {
  name?: string;
  /** Omitted leaves it; empty or null clears it. */
  description?: string | null;
  ownerId?: number | null;
  backupOwnerId?: number | null;
};
