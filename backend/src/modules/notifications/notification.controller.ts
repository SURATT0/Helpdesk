import type { Request, Response } from "express";
import { z } from "zod";
import { Unauthorized } from "../../shared/errors";
import { bus, type NotificationCreatedEvent } from "../../shared/events";
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

  /**
   * SSE stream that pings the caller whenever a notification is created for them
   * — a live replacement for the bell's 30s poll. Carries no payload; the client
   * refetches the (authoritative) list on each ping.
   */
  async stream(req: Request, res: Response) {
    const user = currentUser(req);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(": connected\n\n");

    const onNotify = ({ userId }: NotificationCreatedEvent) => {
      if (userId !== user.id) return;
      res.write("event: notification\ndata: {}\n\n");
    };
    bus.on("notification.created", onNotify);

    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      bus.off("notification.created", onNotify);
    });
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
