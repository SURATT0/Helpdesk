import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { API_PREFIX, env } from "./config/env";
import { logger } from "./shared/logger";
import { errorHandler, notFound } from "./middlewares";
import { requireAuth } from "./middlewares/auth";
import { ticketRoutes } from "./modules/tickets/ticket.routes";
import {
  ticketCommentRoutes,
  commentRoutes,
} from "./modules/comments/comment.routes";
import {
  ticketAttachmentRoutes,
  attachmentRoutes,
} from "./modules/attachments/attachment.routes";
import { categoryRoutes } from "./modules/categories/category.routes";
import { userRoutes } from "./modules/users/user.routes";
import { notificationRoutes } from "./modules/notifications/notification.routes";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes";
import { reportsRoutes } from "./modules/reports/reports.routes";
import { authRoutes } from "./modules/auth/auth.routes";
import { kbRoutes } from "./modules/kb/kb.routes";
import { integrationRoutes } from "./modules/integrations/integration.routes";
import { emailWebhookRoutes } from "./modules/integrations/email/email.routes";
import { healthRoutes } from "./modules/health/health.routes";

export function createApp() {
  const app = express();

  // Request logging — assigns a reqId (honours inbound x-request-id) and picks
  // the log level from the response status. `req.log` is a child logger bound
  // to that reqId, so downstream handlers can log with request correlation.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers["x-request-id"];
        const id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
        res.setHeader("x-request-id", id);
        return id;
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    }),
  );

  app.use(cors({ origin: env.webOrigin, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // Liveness (/health) + readiness (/ready) probes — public, no auth.
  app.use(API_PREFIX, healthRoutes);

  // Feature modules (versioned REST API). `auth` is public; everything else
  // (incl. `kb`) requires a valid access token, with row-level scoping in the
  // repository layer.
  app.use(`${API_PREFIX}/auth`, authRoutes);
  // Public inbound-email webhook — authenticated by a shared secret, not a JWT,
  // so it is mounted before requireAuth (external providers POST here).
  app.use(`${API_PREFIX}/integrations/email-inbound`, emailWebhookRoutes);
  app.use(
    `${API_PREFIX}/tickets/:ticketId/comments`,
    requireAuth,
    ticketCommentRoutes,
  );
  app.use(
    `${API_PREFIX}/tickets/:ticketId/attachments`,
    requireAuth,
    ticketAttachmentRoutes,
  );
  app.use(`${API_PREFIX}/tickets`, requireAuth, ticketRoutes);
  app.use(`${API_PREFIX}/comments`, requireAuth, commentRoutes);
  app.use(`${API_PREFIX}/attachments`, requireAuth, attachmentRoutes);
  app.use(`${API_PREFIX}/categories`, requireAuth, categoryRoutes);
  app.use(`${API_PREFIX}/users`, requireAuth, userRoutes);
  app.use(`${API_PREFIX}/notifications`, requireAuth, notificationRoutes);
  app.use(`${API_PREFIX}/dashboard`, requireAuth, dashboardRoutes);
  app.use(`${API_PREFIX}/reports`, requireAuth, reportsRoutes);
  app.use(`${API_PREFIX}/kb`, requireAuth, kbRoutes);
  app.use(`${API_PREFIX}/integrations`, requireAuth, integrationRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
