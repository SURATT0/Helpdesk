import { z } from "zod";

export const attachmentSchema = z.object({
  id: z.number(),
  /**
   * The name to show: `T<ticket>-<seq>-<slug>.<ext>`, built by the server.
   *
   * The API falls back to the uploader's own name for any row its backfill has
   * not reached, so this is always a usable string — the client never has to
   * decide what to render when a name is missing.
   */
  displayName: z.string(),
  /** What the uploader's machine called it. Shown on hover, nothing else. */
  filename: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  /** The message this file was sent with; null means it belongs to the ticket. */
  commentId: z.number().nullable(),
  /**
   * Whether the thread may draw this inline. Decided by the server from the
   * stored type, so the client keeps no list of renderable formats and a stored
   * SVG is a download card on every surface at once.
   */
  isImage: z.boolean(),
  /** Intrinsic size of the original, for the reserved box. Null if unknown. */
  width: z.number().nullable(),
  height: z.number().nullable(),
  hasThumbnail: z.boolean(),
  createdAt: z.string(),
  uploader: z.object({ id: z.number(), name: z.string() }),
});

export const attachmentListSchema = z.object({
  data: z.array(attachmentSchema),
});
export const attachmentEnvelopeSchema = z.object({ data: attachmentSchema });

export type Attachment = z.infer<typeof attachmentSchema>;
