import { z } from "zod";

/** An agent's email reply to the requester. Subject is optional (auto-derived). */
export const replyBody = z.object({
  to: z.string().email(),
  subject: z.string().max(200).optional(),
  body: z.string().min(1),
  /** Filenames attached on the ticket, listed in the email footer. */
  attachments: z.array(z.string()).max(20).optional(),
});
