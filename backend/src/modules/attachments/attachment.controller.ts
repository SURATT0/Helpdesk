import type { Request, Response } from "express";
import { z } from "zod";
import { BadRequest, Unauthorized } from "../../shared/errors";
import { attachmentService } from "./attachment.service";
import { decodeUploadName } from "./attachment.naming";

const ticketIdParam = z.object({
  ticketId: z.coerce.number().int().positive(),
});
const idParam = z.object({ id: z.coerce.number().int().positive() });
const downloadQuery = z.object({
  disposition: z.enum(["inline", "attachment"]).optional(),
});
const uploadBody = z.object({
  /** The message this file was sent with. Multipart fields arrive as strings. */
  commentId: z.coerce.number().int().positive().optional(),
});

function currentUser(req: Request) {
  if (!req.user) throw Unauthorized();
  return req.user;
}

/**
 * A `Content-Disposition` value that survives a Thai filename.
 *
 * Both forms are emitted, which is what RFC 6266 asks for: `filename` with a
 * transliterated ASCII fallback for anything that only understands it, and
 * `filename*` with the real name percent-encoded per RFC 5987.
 *
 * This used to be `filename="${encodeURIComponent(name)}"` — a percent-encoded
 * string inside the plain parameter, which no client decodes. A file called
 * `ภาพหน้าจอ.png` downloaded as
 * `%E0%B8%A0%E0%B8%B2%E0%B8%9E%E0%B8%AB%E0%B8%99%E0%B9%89%E0%B8%B2%E0%B8%88%E0%B8%AD.png`.
 * The escaping was correct; the parameter was the wrong one.
 */
function contentDisposition(kind: "inline" | "attachment", name: string): string {
  // The ASCII fallback keeps only characters that are safe unquoted, so a name
  // that is entirely non-ASCII degrades to something generic rather than empty.
  const ascii = name.replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "");
  const fallback = ascii.trim().length > 0 ? ascii : "attachment";
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
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
    const { commentId } = uploadBody.parse(req.body ?? {});
    const dto = await attachmentService.upload(
      ticketId,
      // Multipart filenames arrive latin1-decoded from busboy; a Thai name is
      // mojibake until this undoes it. Fixed at the boundary so nothing further
      // in has to know — see decodeUploadName.
      { ...req.file, originalname: decodeUploadName(req.file.originalname) },
      currentUser(req),
      commentId,
    );
    res.status(201).json({ data: dto });
  },

  async download(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const { disposition } = downloadQuery.parse(req.query);
    const file = await attachmentService.read(id, currentUser(req), "full");
    const kind = disposition === "inline" ? "inline" : "attachment";
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", contentDisposition(kind, file.displayName));
    // Private, because every one of these is somebody's ticket. A shared cache
    // must never hold a response that was authorized for one session.
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(file.data);
  },

  /**
   * The resized copy the thread loads, always inline.
   *
   * A separate route rather than a query flag so it can be cached and reasoned
   * about on its own — and so the thread's `<img src>` never carries a parameter
   * that could be flipped to pull the full 25 MB original.
   */
  async thumbnail(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const file = await attachmentService.read(id, currentUser(req), "thumb");
    if (!file.isImage) {
      // Nothing to render. Refusing here means an `<img>` pointed at a PDF gets
      // a clean error the client can fall back from, not a document served as an
      // image with whatever type happened to be stored.
      throw BadRequest("Attachment is not an image");
    }
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", contentDisposition("inline", file.displayName));
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(file.data);
  },

  async remove(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    await attachmentService.remove(id, currentUser(req));
    res.status(204).end();
  },
};
