import type { Request, Response } from "express";
import { Unauthorized } from "../../shared/errors";
import { categoryService } from "./category.service";
import {
  createCategoryBody,
  otherDescriptionsQuery,
} from "./category.validators";

export const categoryController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw Unauthorized();
    res.json({ data: await categoryService.list(req.user) });
  },

  /** What people have typed under "Other", grouped by phrase. */
  async otherDescriptions(req: Request, res: Response) {
    if (!req.user) throw Unauthorized();
    const filter = otherDescriptionsQuery.parse(req.query);
    res.json({ data: await categoryService.otherDescriptions(req.user, filter) });
  },

  /** Promote one of those phrases into a category of the customer's own. */
  async create(req: Request, res: Response) {
    if (!req.user) throw Unauthorized();
    const body = createCategoryBody.parse(req.body);
    res.status(201).json({ data: await categoryService.create(req.user, body) });
  },
};
