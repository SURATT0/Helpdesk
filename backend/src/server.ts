import { createApp } from "./app";
import { env, API_PREFIX, validateEnv } from "./config/env";
import { logger } from "./shared/logger";
import { bus } from "./shared/events";
import { ticketService } from "./modules/tickets/ticket.service";
import { emailOutboxService } from "./modules/emails/email-outbox.service";
import { authService } from "./modules/auth/auth.service";

// Fail fast on a misconfigured environment (missing DB URL, weak/default auth
// secrets in production) before we ever bind a port and serve traffic.
try {
  const { warnings } = validateEnv();
  for (const w of warnings) logger.warn(w);
} catch (err) {
  logger.fatal({ err: (err as Error).message }, "environment validation failed");
  process.exit(1);
}

const app = createApp();

const server = app.listen(env.port, () => {
  logger.info(
    { port: env.port, env: env.nodeEnv },
    `Deskly API listening on http://localhost:${env.port}${API_PREFIX}`,
  );
});

// Graceful shutdown: stop accepting connections, then release the event bus
// (quits the Redis connections cleanly) before exiting.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  server.close();
  try {
    await bus.close();
  } catch (err) {
    logger.error({ err }, "error closing event bus");
  }
  process.exit(0);
}
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => void shutdown(sig));
}

// Background sweep: auto-close tickets left resolved > 72h (run on boot + hourly).
if (env.autoClose) {
  const sweep = () =>
    ticketService
      .autoCloseStale()
      .then((n) => {
        if (n > 0) logger.info({ closed: n }, "auto-closed stale resolved tickets");
      })
      .catch((err) => logger.error({ err }, "auto-close sweep failed"));
  sweep();
  setInterval(sweep, 60 * 60 * 1000).unref();
}

// Background sweep: notify staff about SLA clocks nearing or past due. Every 15
// minutes rather than hourly — the danger threshold is one hour, so an hourly
// cadence could deliver a "breaches in 1h" warning after it had already
// breached. The sweep is idempotent, so the extra runs are cheap no-ops.
if (env.slaAlerts) {
  const sweep = () =>
    ticketService
      .sweepSlaAlerts()
      .then(({ warned, breached }) => {
        if (warned + breached > 0) {
          logger.info({ warned, breached }, "sent SLA alerts");
        }
      })
      .catch((err) => logger.error({ err }, "SLA alert sweep failed"));
  sweep();
  setInterval(sweep, 15 * 60 * 1000).unref();
}

// Background sweep: deliver the queued ticket emails. Every 60s, which is
// near-real-time for a help desk without turning into a hot loop; the sweep is a
// single indexed query when there is nothing to do.
//
// This replaced a sweep over `notifications.emailed_at`. The two must never run
// together — they would each deliver the same event — so the old one is gone
// rather than disabled, and the migration stamped its backlog as handled.
if (env.notificationEmails) {
  // One pass at a time. A pass is bounded by a batch limit, not by the clock,
  // so a slow or unreachable mail server makes it outlast its own interval —
  // and without this guard every tick would start another one on top, each
  // holding sockets and database connections until the pool is gone and the API
  // starts timing out. Skipping a tick costs at most a minute of latency on a
  // notification; overlapping them costs the whole process.
  let running = false;
  const sweep = () => {
    if (running) {
      logger.debug("ticket email sweep still running; skipping this tick");
      return;
    }
    running = true;
    emailOutboxService
      .sweep()
      .then(({ sent, failed, suppressed, collapsed }) => {
        if (sent + failed + collapsed > 0) {
          logger.info(
            { sent, failed, suppressed, collapsed },
            "ticket email sweep",
          );
        }
      })
      .catch((err) => logger.error({ err }, "ticket email sweep failed"))
      .finally(() => {
        running = false;
      });
  };
  sweep();
  setInterval(sweep, 60 * 1000).unref();
}

// Background sweep: warn requesters before the auto-close takes their ticket.
// Hourly, matching the auto-close sweep it runs ahead of — the reminder lead is
// measured in hours, so a finer cadence would only re-run an idempotent query.
// Tied to the same switch as the auto-close itself: with nothing closing tickets
// there is nothing to warn about.
if (env.autoClose && env.ticketEmail.enabled) {
  const sweep = () =>
    ticketService
      .sweepAutoCloseReminders()
      .then((n) => {
        if (n > 0) logger.info({ queued: n }, "queued auto-close reminders");
      })
      .catch((err) => logger.error({ err }, "auto-close reminder sweep failed"));
  sweep();
  setInterval(sweep, 60 * 60 * 1000).unref();
}

// Background sweep: delete expired refresh tokens (run on boot + hourly). Hourly
// is generous for rows that already expired — nothing about correctness depends on
// the cadence, only how large the table gets between passes. The login path also
// clears the caller's own expired rows, but only for whoever comes back; this is
// what reaches the sessions of accounts that never log in again.
if (env.sessionSweep) {
  const sweep = () =>
    authService
      .sweepExpiredSessions()
      .then((deleted) => {
        if (deleted > 0) logger.info({ deleted }, "deleted expired refresh tokens");
      })
      .catch((err) => logger.error({ err }, "session sweep failed"));
  sweep();
  setInterval(sweep, 60 * 60 * 1000).unref();
}
