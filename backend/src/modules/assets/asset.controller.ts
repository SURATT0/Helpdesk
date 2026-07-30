import type { Request, Response } from "express";
import { z } from "zod";
import { Unauthorized } from "../../shared/errors";
import { assetService } from "./asset.service";
import {
  createAssetSchema,
  listAssetsQuerySchema,
  updateAssetSchema,
} from "./asset.validators";

const assetIdParam = z.object({ id: z.coerce.number().int().positive() });

// requireAuth runs before these, so req.user is set — narrow it for the service.
function currentUser(req: Request) {
  if (!req.user) throw Unauthorized();
  return req.user;
}

export const assetController = {
  async list(req: Request, res: Response) {
    const query = listAssetsQuerySchema.parse(req.query);
    const data = await assetService.list(currentUser(req), query);
    res.json({ data, meta: { total: data.length } });
  },

  async get(req: Request, res: Response) {
    const { id } = assetIdParam.parse(req.params);
    const data = await assetService.get(id, currentUser(req));
    res.json({ data });
  },

  async create(req: Request, res: Response) {
    const input = createAssetSchema.parse(req.body);
    const data = await assetService.create(input, currentUser(req));
    res.status(201).json({ data });
  },

  async update(req: Request, res: Response) {
    const { id } = assetIdParam.parse(req.params);
    const input = updateAssetSchema.parse(req.body);
    const data = await assetService.update(id, input, currentUser(req));
    res.json({ data });
  },

  async retire(req: Request, res: Response) {
    const { id } = assetIdParam.parse(req.params);
    const data = await assetService.retire(id, currentUser(req));
    res.json({ data });
  },
};
