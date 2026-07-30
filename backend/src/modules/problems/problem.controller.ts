import type { Request, Response } from "express";
import { z } from "zod";
import { Unauthorized } from "../../shared/errors";
import { problemService } from "./problem.service";
import {
  linkOrConvertSchema,
  listProblemsQuerySchema,
} from "./problem.validators";

const idParam = z.object({ id: z.coerce.number().int().positive() });

// requireAuth runs before these, so req.user is set — narrow it for the service.
function currentUser(req: Request) {
  if (!req.user) throw Unauthorized();
  return req.user;
}

export const problemController = {
  async list(req: Request, res: Response) {
    const query = listProblemsQuerySchema.parse(req.query);
    const data = await problemService.list(currentUser(req), query);
    res.json({ data, meta: { total: data.length } });
  },

  async get(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const data = await problemService.get(id, currentUser(req));
    res.json({ data });
  },

  /** POST /tickets/:id/problem — link to an existing problem, or convert. */
  async linkOrConvert(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const input = linkOrConvertSchema.parse(req.body);
    const data = await problemService.linkOrConvert(id, input, currentUser(req));
    res.status(input.problemId != null ? 200 : 201).json({ data });
  },

  /** DELETE /tickets/:id/problem — detach without touching the problem itself. */
  async unlink(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    await problemService.unlink(id, currentUser(req));
    res.status(204).end();
  },
};
