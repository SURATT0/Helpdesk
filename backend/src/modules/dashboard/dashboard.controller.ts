import type { Request, Response } from "express";
import { Unauthorized } from "../../shared/errors";
import { dashboardService } from "./dashboard.service";

export const dashboardController = {
  async summary(req: Request, res: Response) {
    if (!req.user) throw Unauthorized();
    res.json({ data: await dashboardService.summary(req.user) });
  },
};
