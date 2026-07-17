import type { Request, Response } from "express";
import { z } from "zod";
import { BadRequest, Unauthorized } from "../../shared/errors";
import { attachmentService } from "./attachment.service";

const ticketIdParam = z.object({
  ticketId: z.coerce.number().int().positive(),
});
const idParam = z.object({ id: z.coerce.number().int().positive() });
const downloadQuery = z.object({
  disposition: z.enum(["inline", "attachment"]).optional(),
});

function currentUser(req: Request) {
  if (!req.user) throw Unauthorized();
  return req.user;
}

export const attachmentController = {
  async list(req: Request, res: Response) {
    const { ticketId } = ticketIdParam.parse(req.params);
    const data = await attachmentService.list(ticketId, currentUser(req));
    res.json({ data });
  },

  async upload(req: Request, res: Response) {
    const { ticketId } = ticketIdParam.parse(req.params);
    if (!req.file) throw BadRequest("No file uploaded (field 'file')");
    const dto = await attachmentService.upload(
      ticketId,
      req.file,
      currentUser(req),
    );
    res.status(201).json({ data: dto });
  },

  async download(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const { disposition } = downloadQuery.parse(req.query);
    const file = await attachmentService.download(id, currentUser(req));
    const kind = disposition === "inline" ? "inline" : "attachment";
    res.setHeader("Content-Type", file.contentType);
    res.setHeader(
      "Content-Disposition",
      `${kind}; filename="${encodeURIComponent(file.filename)}"`,
    );
    res.send(file.data);
  },

  async remove(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    await attachmentService.remove(id, currentUser(req));
    res.status(204).end();
  },
};
