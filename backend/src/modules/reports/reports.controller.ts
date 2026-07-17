import type { Request, Response } from "express";
import { Unauthorized } from "../../shared/errors";
import { reportsService } from "./reports.service";

export const reportsController = {
  async slaSummary(req: Request, res: Response) {
    if (!req.user) throw Unauthorized();
    res.json({ data: await reportsService.slaSummary(req.user) });
  },
};
