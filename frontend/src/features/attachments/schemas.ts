import { z } from "zod";

export const attachmentSchema = z.object({
  id: z.number(),
  filename: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  createdAt: z.string(),
  uploader: z.object({ id: z.number(), name: z.string() }),
});

export const attachmentListSchema = z.object({
  data: z.array(attachmentSchema),
});
export const attachmentEnvelopeSchema = z.object({ data: attachmentSchema });

export type Attachment = z.infer<typeof attachmentSchema>;
