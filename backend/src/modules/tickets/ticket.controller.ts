import type { Request, Response } from "express";
import { Unauthorized } from "../../shared/errors";
import { ticketService } from "./ticket.service";
import {
  createTicketBody,
  importTicketsBody,
  listTicketsQuery,
  ticketIdParam,
  updateAssigneeBody,
  updatePriorityBody,
  updateStatusBody,
} from "./ticket.validators";

// requireAuth runs before these, so req.user is set — narrow it for the service.
function currentUser(req: Request) {
  if (!req.user) throw Unauthorized();
  return req.user;
}

export const ticketController = {
  async list(req: Request, res: Response) {
    const query = listTicketsQuery.parse(req.query);
    const data = await ticketService.list(query, currentUser(req));
    res.json({ data, meta: { total: data.length } });
  },

  async get(req: Request, res: Response) {
    const { id } = ticketIdParam.parse(req.params);
    const ticket = await ticketService.get(id, currentUser(req));
    res.json({ data: ticket });
  },

  async create(req: Request, res: Response) {
    const input = createTicketBody.parse(req.body);
    const ticket = await ticketService.create(input, currentUser(req));
    res.status(201).json({ data: ticket });
  },

  async importTickets(req: Request, res: Response) {
    const { rows } = importTicketsBody.parse(req.body);
    const result = await ticketService.importMany(rows, currentUser(req));
    // Always a 2xx: this is a batch result, and per-row failures are carried in
    // the body so the client can surface them for correction and retry.
    res.status(result.created > 0 ? 201 : 200).json({ data: result });
  },

  async history(req: Request, res: Response) {
    const { id } = ticketIdParam.parse(req.params);
    const data = await ticketService.history(id, currentUser(req));
    res.json({ data });
  },

  async updateStatus(req: Request, res: Response) {
    const { id } = ticketIdParam.parse(req.params);
    const { status } = updateStatusBody.parse(req.body);
    const ticket = await ticketService.changeStatus(id, status, currentUser(req));
    res.json({ data: ticket });
  },

  async updateAssignee(req: Request, res: Response) {
    const { id } = ticketIdParam.parse(req.params);
    const { assigneeId } = updateAssigneeBody.parse(req.body);
    const ticket = await ticketService.changeAssignee(
      id,
      assigneeId,
      currentUser(req),
    );
    res.json({ data: ticket });
  },

  async updatePriority(req: Request, res: Response) {
    const { id } = ticketIdParam.parse(req.params);
    const { priority } = updatePriorityBody.parse(req.body);
    const ticket = await ticketService.changePriority(
      id,
      priority,
      currentUser(req),
    );
    res.json({ data: ticket });
  },
};
