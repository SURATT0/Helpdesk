import { z } from "zod";

export const sourceInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  implemented: z.boolean(),
  configured: z.boolean(),
});
export const sourceListSchema = z.object({ data: z.array(sourceInfoSchema) });

const importRowResultSchema = z.discriminatedUnion("ok", [
  z.object({ index: z.number(), ok: z.literal(true), ticketId: z.number() }),
  z.object({
    index: z.number(),
    ok: z.literal(false),
    field: z.string().nullable(),
    error: z.string(),
  }),
]);

export const syncResultSchema = z.object({
  source: z.string(),
  fetched: z.number(),
  import: z.object({
    created: z.number(),
    failed: z.number(),
    results: z.array(importRowResultSchema),
  }),
});
export const syncResultEnvelope = z.object({ data: syncResultSchema });

export const emailStatusSchema = z.object({
  webhookEnabled: z.boolean(),
  endpoint: z.string(),
  imapConfigured: z.boolean(),
});
export const emailStatusEnvelope = z.object({ data: emailStatusSchema });

export type SourceInfo = z.infer<typeof sourceInfoSchema>;
export type SyncResult = z.infer<typeof syncResultSchema>;
export type EmailStatus = z.infer<typeof emailStatusSchema>;
