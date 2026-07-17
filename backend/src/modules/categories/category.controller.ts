import type { Request, Response } from "express";
import { categoryService } from "./category.service";

export const categoryController = {
  async list(_req: Request, res: Response) {
    const data = await categoryService.list();
    res.json({ data });
  },
};
