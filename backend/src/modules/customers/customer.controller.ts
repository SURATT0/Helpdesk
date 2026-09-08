import type { Request, Response } from "express";
import { Unauthorized } from "../../shared/errors";
import { customerService } from "./customer.service";
import {
  createCustomerBody,
  customerIdParam,
  renameCustomerBody,
} from "./customer.validators";

function currentUser(req: Request) {
  if (!req.user) throw Unauthorized();
  return req.user;
}

export const customerController = {
  async list(req: Request, res: Response) {
    res.json({ data: await customerService.list(currentUser(req)) });
  },

  async get(req: Request, res: Response) {
    const { id } = customerIdParam.parse(req.params);
    res.json({ data: await customerService.get(id, currentUser(req)) });
  },

  async create(req: Request, res: Response) {
    const { name } = createCustomerBody.parse(req.body);
    const customer = await customerService.create(name, currentUser(req));
    res.status(201).json({ data: customer });
  },

  async rename(req: Request, res: Response) {
    const { id } = customerIdParam.parse(req.params);
    const { name } = renameCustomerBody.parse(req.body);
    res.json({ data: await customerService.rename(id, name, currentUser(req)) });
  },

  async archiveImpact(req: Request, res: Response) {
    const { id } = customerIdParam.parse(req.params);
    res.json({ data: await customerService.archiveImpact(id, currentUser(req)) });
  },

  async archive(req: Request, res: Response) {
    const { id } = customerIdParam.parse(req.params);
    await customerService.archive(id, currentUser(req));
    res.status(204).end();
  },
};
