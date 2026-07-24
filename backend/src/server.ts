import { createApp } from "./app";
import { env, API_PREFIX, validateEnv } from "./config/env";
import { logger } from "./shared/logger";
import { bus } from "./shared/events";
import { ticketService } from "./modules/tickets/ticket.service";

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
