import type { Request, Response } from "express";
import { z } from "zod";
import { Unauthorized } from "../../shared/errors";
import { integrationService } from "./integration.service";
import { emailService } from "./email/email.service";

function currentUser(req: Request) {
  if (!req.user) throw Unauthorized();
  return req.user;
}

const sourceIdParam = z.object({ id: z.string().min(1) });

export const integrationController = {
  async listSources(_req: Request, res: Response) {
    res.json({ data: integrationService.listSources() });
  },

  async emailStatus(_req: Request, res: Response) {
    res.json({ data: emailService.status() });
  },

  async sync(req: Request, res: Response) {
    const { id } = sourceIdParam.parse(req.params);
    const result = await integrationService.syncFromSource(id, currentUser(req));
    // Always a 2xx: per-row failures are carried in the body (like CSV import).
    //
    // 201 when the sync actually made something. For mail that means a new
    // ticket OR a reply threaded onto one — a run that only found duplicates
    // created nothing and says 200, which is the honest answer and the one a
    // caller can tell apart from "it worked".
    const created =
      result.kind === "mail"
        ? result.mail.tickets + result.mail.comments > 0
        : result.import.created > 0;
    res.status(created ? 201 : 200).json({ data: result });
  },
};
