import type { Request, Response } from "express";
import { Unauthorized } from "../../shared/errors";
import { PERIOD_LIST_LIMIT, ticketService } from "./ticket.service";
import {
  closedHistoryQuery,
  closedPeriodsQuery,
  createTicketBody,
  idempotencyKeyHeader,
  importTicketsBody,
  listTicketsQuery,
  setAffectedAssetsBody,
  setAffectedUsersBody,
  ticketIdParam,
  reassignBody,
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

  /**
   * The periods that hold closed tickets, for the history log's picker. Each
   * carries its own window so the client labels it with the same formatter it
   * uses for the window on screen, and `truncated` says plainly whether the list
   * was clipped rather than letting a partial list read as complete.
   */
  async closedPeriods(req: Request, res: Response) {
    const { granularity } = closedPeriodsQuery.parse(req.query);
    const { periods, truncated } = await ticketService.closedPeriods(
      granularity,
      currentUser(req),
    );
    res.json({
      data: periods.map((p) => ({
        start: p.start.toISOString(),
        end: p.end.toISOString(),
        count: p.count,
      })),
      meta: {
        granularity,
        returned: periods.length,
        limit: PERIOD_LIST_LIMIT,
        truncated,
      },
    });
  },

  /**
   * The closed-ticket history log. `meta.period` carries the window the server
   * resolved plus the anchors either side, so the client labels and navigates
   * from the response instead of computing calendar boundaries itself — or null
   * when the caller asked for the whole archive (`granularity=all`).
   */
  async closedHistory(req: Request, res: Response) {
    const query = closedHistoryQuery.parse(req.query);
    const { items, total, period } = await ticketService.closedHistory(
      query,
      currentUser(req),
    );
    res.json({
      data: items,
      meta: {
        total,
        limit: query.limit,
        offset: query.offset,
        returned: items.length,
        // Null in `all` mode — there is no window, so there is nothing to label
        // and no anchor either side of it.
        period: period && {
          granularity: period.granularity,
          start: period.start.toISOString(),
          end: period.end.toISOString(),
          prevAnchor: period.prevAnchor.toISOString(),
          nextAnchor: period.nextAnchor.toISOString(),
          isCurrent: period.isCurrent,
        },
      },
    });
  },

  async get(req: Request, res: Response) {
    const { id } = ticketIdParam.parse(req.params);
    const ticket = await ticketService.get(id, currentUser(req));
    res.json({ data: ticket });
  },

  async create(req: Request, res: Response) {
    const input = createTicketBody.parse(req.body);
    // Optional, and deliberately so: a client that sends a key gets its retries
    // collapsed onto one ticket, and one that doesn't keeps the old behaviour.
    const header = req.get("Idempotency-Key");
    const idempotencyKey =
      header == null ? undefined : idempotencyKeyHeader.parse(header);
    const ticket = await ticketService.create(
      { ...input, idempotencyKey },
      currentUser(req),
    );
    // 201 on a replay too. The point of an idempotent create is that the client
    // cannot tell the retry apart from the original, so it takes the same path.
    res.status(201).json({ data: ticket });
  },

  async remove(req: Request, res: Response) {
    const { id } = ticketIdParam.parse(req.params);
    await ticketService.remove(id, currentUser(req));
    res.status(204).send();
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

  async reassign(req: Request, res: Response) {
    const input = reassignBody.parse(req.body);
    const result = await ticketService.reassignAll(input, currentUser(req));
    res.json({
      data: result,
      meta: { moved: result.movedTicketIds.length, remaining: result.remaining },
    });
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

  async setAffectedUsers(req: Request, res: Response) {
    const { id } = ticketIdParam.parse(req.params);
    const { userIds } = setAffectedUsersBody.parse(req.body);
    const ticket = await ticketService.setAffectedUsers(
      id,
      userIds,
      currentUser(req),
    );
    res.json({ data: ticket });
  },

  async setAffectedAssets(req: Request, res: Response) {
    const { id } = ticketIdParam.parse(req.params);
    const { assetIds } = setAffectedAssetsBody.parse(req.body);
    const ticket = await ticketService.setAffectedAssets(
      id,
      assetIds,
      currentUser(req),
    );
    res.json({ data: ticket });
  },
};
