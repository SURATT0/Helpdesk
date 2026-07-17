import type { Request, Response } from "express";
import { env } from "../../config/env";
import { healthRepository } from "./health.repository";

export const healthController = {
  // Liveness: the process is up. No dependency checks — a failing liveness
  // probe means "restart me", which a DB outage should NOT trigger.
  live(_req: Request, res: Response) {
    res.json({ status: "ok", env: env.nodeEnv, uptime: process.uptime() });
  },

  // Readiness: can we actually serve traffic? Gated on the database, so an
  // orchestrator holds traffic (and compose holds `web`) until the DB is up.
  async ready(_req: Request, res: Response) {
    const database = await healthRepository.ping();
    res
      .status(database ? 200 : 503)
      .json({
        status: database ? "ready" : "not_ready",
        checks: { database: database ? "up" : "down" },
      });
  },
};
