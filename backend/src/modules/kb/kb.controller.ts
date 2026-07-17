import type { Request, Response } from "express";
import { z } from "zod";
import { kbService } from "./kb.service";

const listQuery = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
});
const suggestQuery = z.object({ q: z.string().optional() });
const idParam = z.object({ id: z.string().min(1) });

export const kbController = {
  async list(req: Request, res: Response) {
    const { q, category } = listQuery.parse(req.query);
    res.json({
      data: kbService.list({ q, category }),
      meta: { categories: kbService.categories() },
    });
  },

  async suggest(req: Request, res: Response) {
    const { q } = suggestQuery.parse(req.query);
    res.json({ data: kbService.suggest(q ?? "") });
  },

  async get(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    res.json({ data: kbService.get(id) });
  },
};
