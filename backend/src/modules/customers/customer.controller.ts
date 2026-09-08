import type { Request, Response } from "express";
import { Unauthorized } from "../../shared/errors";
import { customerRepository } from "./customer.repository";

function currentUser(req: Request) {
  if (!req.user) throw Unauthorized();
  return req.user;
}

export const customerController = {
  async list(req: Request, res: Response) {
    res.json({ data: await customerRepository.findMany(currentUser(req)) });
  },
};
