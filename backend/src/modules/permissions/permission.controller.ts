import type { Request, Response } from "express";
import { Unauthorized } from "../../shared/errors";
import { permissionService } from "./permission.service";
import { setGrantsBody } from "./permission.validators";

export const permissionController = {
  async matrix(req: Request, res: Response) {
    if (!req.user) throw Unauthorized();
    res.json({ data: await permissionService.matrix(req.user) });
  },

  async setGrants(req: Request, res: Response) {
    if (!req.user) throw Unauthorized();
    const body = setGrantsBody.parse(req.body);
    res.json({ data: await permissionService.setGrants(req.user, body) });
  },
};
