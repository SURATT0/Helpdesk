import type { Request, Response } from "express";
import { Unauthorized } from "../../shared/errors";
import { auditService } from "./audit.service";
import { auditQuery } from "./audit.validators";

// requireAuth runs before these, so req.user is set — narrow it for the service.
function currentUser(req: Request) {
  if (!req.user) throw Unauthorized();
  return req.user;
}

export const auditController = {
  /** GET /audit — the trail, newest first, row-scoped in the repository. */
  async list(req: Request, res: Response) {
    const query = auditQuery.parse(req.query);
    const { items, total } = await auditService.list(query, currentUser(req));
    res.json({
      data: items,
      meta: {
        total,
        limit: query.limit,
        offset: query.offset,
        returned: items.length,
      },
    });
  },

  /** GET /audit/actions — distinct action names, for the filter dropdown. */
  async actions(req: Request, res: Response) {
    const data = await auditService.actions(currentUser(req));
    res.json({ data });
  },
};
