import type { Request, Response } from "express";
import { z } from "zod";
import { Unauthorized } from "../../shared/errors";
import { notificationService } from "./notification.service";

const idParam = z.object({ id: z.coerce.number().int().positive() });

function currentUser(req: Request) {
  if (!req.user) throw Unauthorized();
  return req.user;
}

export const notificationController = {
  async list(req: Request, res: Response) {
    const { items, unread } = await notificationService.list(currentUser(req));
    res.json({ data: items, meta: { unread } });
  },

  async markRead(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    await notificationService.markRead(id, currentUser(req));
    res.status(204).end();
  },

  async markAllRead(req: Request, res: Response) {
    await notificationService.markAllRead(currentUser(req));
    res.status(204).end();
  },
};
