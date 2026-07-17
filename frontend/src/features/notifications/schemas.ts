import { z } from "zod";

export const notificationSchema = z.object({
  id: z.number(),
  type: z.string(),
  ticketId: z.number().nullable(),
  message: z.string(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});

export const notificationListSchema = z.object({
  data: z.array(notificationSchema),
  meta: z.object({ unread: z.number() }),
});

export type Notification = z.infer<typeof notificationSchema>;
