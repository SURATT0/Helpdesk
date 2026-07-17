import type { Request, Response } from "express";
import { Unauthorized } from "../../shared/errors";
import { userService } from "./user.service";
import {
  updateProfileBody,
  updateUserBody,
  userIdParam,
} from "./user.validators";

function currentUser(req: Request) {
  if (!req.user) throw Unauthorized();
  return req.user;
}

export const userController = {
  async list(_req: Request, res: Response) {
    res.json({ data: await userService.list() });
  },

  async get(req: Request, res: Response) {
    const { id } = userIdParam.parse(req.params);
    res.json({ data: await userService.get(id) });
  },

  async updateMe(req: Request, res: Response) {
    const body = updateProfileBody.parse(req.body);
    const user = await userService.updateProfile(body, currentUser(req));
    res.json({ data: user });
  },

  async update(req: Request, res: Response) {
    const { id } = userIdParam.parse(req.params);
    const body = updateUserBody.parse(req.body);
    const user = await userService.update(id, body, currentUser(req));
    res.json({ data: user });
  },
};
