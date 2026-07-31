import type { Request, Response } from "express";
import { Unauthorized } from "../../shared/errors";
import { projectService } from "./project.service";
import {
  createProjectBody,
  projectIdParam,
  updateProjectBody,
} from "./project.validators";

// requireAuth runs before these, so req.user is set — narrow it for the service.
function currentUser(req: Request) {
  if (!req.user) throw Unauthorized();
  return req.user;
}

export const projectController = {
  async list(req: Request, res: Response) {
    const data = await projectService.list(currentUser(req));
    res.json({ data, meta: { total: data.length } });
  },

  async get(req: Request, res: Response) {
    const { id } = projectIdParam.parse(req.params);
    const project = await projectService.get(id, currentUser(req));
    res.json({ data: project });
  },

  async create(req: Request, res: Response) {
    const input = createProjectBody.parse(req.body);
    const project = await projectService.create(input, currentUser(req));
    res.status(201).json({ data: project });
  },

  async update(req: Request, res: Response) {
    const { id } = projectIdParam.parse(req.params);
    const input = updateProjectBody.parse(req.body);
    const project = await projectService.update(id, input, currentUser(req));
    res.json({ data: project });
  },
};
