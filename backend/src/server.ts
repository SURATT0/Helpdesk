import { createApp } from "./app";
import { env, API_PREFIX, validateEnv } from "./config/env";
import { logger } from "./shared/logger";
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

app.listen(env.port, () => {
  logger.info(
    { port: env.port, env: env.nodeEnv },
    `Deskly API listening on http://localhost:${env.port}${API_PREFIX}`,
  );
});

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
