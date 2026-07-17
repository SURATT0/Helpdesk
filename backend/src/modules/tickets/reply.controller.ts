import type { Request, Response } from "express";
import { Unauthorized } from "../../shared/errors";
import { replyService } from "./reply.service";
import { ticketIdParam } from "./ticket.validators";
import { replyBody } from "./reply.validators";

function currentUser(req: Request) {
  if (!req.user) throw Unauthorized();
  return req.user;
}

export const replyController = {
  async send(req: Request, res: Response) {
    const { id } = ticketIdParam.parse(req.params);
    const input = replyBody.parse(req.body);
    const result = await replyService.send(id, input, currentUser(req));
    res.status(201).json({ data: result });
  },
};
