import type { Request, Response } from "express";
import { Unauthorized } from "../../shared/errors";
import { serviceCatalogRepository } from "./service-catalog.repository";

export const serviceCatalogController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw Unauthorized();
    res.json({ data: await serviceCatalogRepository.list() });
  },
};
