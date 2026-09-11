import type { Request, Response } from "express";
import { Unauthorized } from "../../shared/errors";
import { userService } from "./user.service";
import {
  approveUserBody,
  listUsersQuery,
  rejectUserBody,
  updateProfileBody,
  updateUserBody,
  userIdParam,
  setReachBody,
} from "./user.validators";

function currentUser(req: Request) {
  if (!req.user) throw Unauthorized();
  return req.user;
}

export const userController = {
  async list(req: Request, res: Response) {
    const filters = listUsersQuery.parse(req.query);
    res.json({ data: await userService.list(currentUser(req), filters) });
  },

  async approve(req: Request, res: Response) {
    const { id } = userIdParam.parse(req.params);
    const body = approveUserBody.parse(req.body);
    res.json({ data: await userService.approve(id, body, currentUser(req)) });
  },

  async reject(req: Request, res: Response) {
    const { id } = userIdParam.parse(req.params);
    const { reason } = rejectUserBody.parse(req.body);
    res.json({ data: await userService.reject(id, reason, currentUser(req)) });
  },

  async get(req: Request, res: Response) {
    const { id } = userIdParam.parse(req.params);
    res.json({ data: await userService.get(id, currentUser(req)) });
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

  async setReach(req: Request, res: Response) {
    const { id } = userIdParam.parse(req.params);
    const { customerIds } = setReachBody.parse(req.body);
    const user = await userService.setReach(id, customerIds, currentUser(req));
    res.json({ data: user });
  },
};
