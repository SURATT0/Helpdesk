import type { Request, Response } from "express";
import { Unauthorized } from "../../shared/errors";
import { categoryService } from "./category.service";

export const categoryController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw Unauthorized();
    res.json({ data: await categoryService.list(req.user) });
  },
};
