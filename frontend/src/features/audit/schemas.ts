import { z } from "zod";
import { roleSchema } from "@/features/auth/schemas";

export const auditActorSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
});

export const auditEntrySchema = z.object({
  id: z.number(),
  action: z.string(),
  entity: z.string(),
  entityId: z.number().nullable(),
  /** Null for system writes — e.g. a requester created from an inbound email. */
  actor: auditActorSchema.nullable(),
  /** Free-form per-action detail; shape varies by action, so kept unknown. */
  meta: z.unknown(),
  createdAt: z.string(),
});

export const auditListSchema = z.object({
  data: z.array(auditEntrySchema),
  meta: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    returned: z.number(),
  }),
});

export const auditActionsSchema = z.object({ data: z.array(z.string()) });

export type AuditActor = z.infer<typeof auditActorSchema>;
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export type AuditPage = z.infer<typeof auditListSchema>;
