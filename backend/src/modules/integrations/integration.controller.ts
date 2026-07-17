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
    res.status(result.import.created > 0 ? 201 : 200).json({ data: result });
  },
};
