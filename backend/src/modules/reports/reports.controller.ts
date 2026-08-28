import type { Request, Response } from "express";
import { Unauthorized } from "../../shared/errors";
import { reportsService } from "./reports.service";
import { workloadQuery } from "./reports.validators";

export const reportsController = {
  async slaSummary(req: Request, res: Response) {
    if (!req.user) throw Unauthorized();
    res.json({ data: await reportsService.slaSummary(req.user) });
  },

  /** The whole desk, compared. Refused with a 403 to anyone but a super admin. */
  async agentWorkload(req: Request, res: Response) {
    if (!req.user) throw Unauthorized();
    res.json({ data: await reportsService.agentWorkload(req.user) });
  },

  /** One person: yourself, or anyone if you may see the table above. */
  async workload(req: Request, res: Response) {
    if (!req.user) throw Unauthorized();
    const { assigneeId } = workloadQuery.parse(req.query);
    res.json({ data: await reportsService.workloadFor(req.user, assigneeId) });
  },
};
