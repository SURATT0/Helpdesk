import { z } from "zod";
import { freeText, TEXT_MAX } from "../../shared/text";

/** An agent's email reply to the requester. Subject is optional (auto-derived). */
export const replyBody = z.object({
  to: z.string().email(),
  subject: freeText({ max: TEXT_MAX.SUBJECT }).optional(),
  body: freeText({ max: TEXT_MAX.BODY }),
  /** Filenames attached on the ticket, listed in the email footer. */
  attachments: z.array(z.string()).max(20).optional(),
});
