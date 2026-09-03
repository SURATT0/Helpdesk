import type { Request, Response } from "express";
import { Unauthorized } from "../../shared/errors";
import { EMAIL_EVENTS } from "../emails/email.events";
import { settingsService } from "./settings.service";
import { LIMITS } from "./settings.types";
import {
  customerQuery,
  toStored,
  updateSettingsBody,
} from "./settings.validators";

function currentUser(req: Request) {
  if (!req.user) throw Unauthorized();
  return req.user;
}

export const settingsController = {
  /**
   * The settings screen's read.
   *
   * `meta` carries what the screen needs to render itself without hard-coding a
   * copy of the server's vocabulary: the event catalogue to list, and the bounds
   * to put on the number inputs. Both would otherwise be duplicated in the
   * client and drift the first time either changed.
   */
  async get(req: Request, res: Response) {
    const { customerId } = customerQuery.parse(req.query);
    const data = await settingsService.get(currentUser(req), customerId);
    res.json({ data, meta: { events: EMAIL_EVENTS, limits: LIMITS } });
  },

  async update(req: Request, res: Response) {
    const { customerId } = customerQuery.parse(req.query);
    const body = updateSettingsBody.parse(req.body);
    const data = await settingsService.update(
      currentUser(req),
      toStored(body),
      customerId,
    );
    res.json({ data });
  },

  async reset(req: Request, res: Response) {
    const { customerId } = customerQuery.parse(req.query);
    const data = await settingsService.reset(currentUser(req), customerId);
    res.json({ data });
  },
};
