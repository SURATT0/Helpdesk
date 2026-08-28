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
 * What deleting a project would disturb.
 *
 * `members` counts everyone routing through it — its listed members plus the
 * owner and backup owner. Deliberately NOT a ticket count: a ticket carries no
 * project (routing reads the requester's project once, at creation, and keeps
 * only the assignee it picked), so "tickets in this project" is not a question
 * the data can answer. What deletion would break is routing, and membership is
 * what routing reads.
 */
export const projectDeletionImpactSchema = z.object({
  data: z.object({
    id: z.number(),
    name: z.string(),
    customerId: z.number(),
    members: z.number(),
  }),
});

export type ProjectDeletionImpact = z.infer<
  typeof projectDeletionImpactSchema
>["data"];

export type Project = z.infer<typeof projectSchema>;
export type ProjectOwner = z.infer<typeof projectOwnerSchema>;

export type CreateProjectInput = {
  name: string;
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
  ownerId?: number | null;
  backupOwnerId?: number | null;
};
