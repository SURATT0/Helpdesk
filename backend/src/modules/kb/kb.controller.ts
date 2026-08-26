import type { Request, Response } from "express";
import { Unauthorized } from "../../shared/errors";
import { kbService } from "./kb.service";
import {
  createArticleBody,
  idParam,
  listQuery,
  suggestQuery,
  updateArticleBody,
} from "./kb.validators";

// requireAuth runs before these, so req.user is set — narrow it for the service.
function currentUser(req: Request) {
  if (!req.user) throw Unauthorized();
  return req.user;
}

export const kbController = {
  async list(req: Request, res: Response) {
    const { q, category } = listQuery.parse(req.query);
    const actor = currentUser(req);
    // Both reads depend on who is asking (drafts), so they are issued together
    // rather than the filter list being computed from a different visibility.
    const [data, categories] = await Promise.all([
      kbService.list({ q, category }, actor),
      kbService.categories(actor),
    ]);
    res.json({ data, meta: { categories } });
  },

  async suggest(req: Request, res: Response) {
    const { q } = suggestQuery.parse(req.query);
    res.json({ data: await kbService.suggest(q ?? "", currentUser(req)) });
  },

  async get(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    res.json({ data: await kbService.get(id, currentUser(req)) });
  },

  async create(req: Request, res: Response) {
    const input = createArticleBody.parse(req.body);
    const article = await kbService.create(input, currentUser(req));
    res.status(201).json({ data: article });
  },

  async update(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const input = updateArticleBody.parse(req.body);
    const article = await kbService.update(id, input, currentUser(req));
    res.json({ data: article });
  },

  async remove(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    await kbService.remove(id, currentUser(req));
    res.status(204).send();
  },
};
