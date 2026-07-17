import pino from "pino";
import { env } from "../config/env";

const isDev = env.nodeEnv !== "production";

// Redaction applies before any transport, so tokens/cookies never reach stdout
// OR the aggregator.
const redact = {
  paths: [
    "req.headers.authorization",
    "req.headers.cookie",
    'res.headers["set-cookie"]',
  ],
  censor: "[Redacted]",
};

/**
 * Build the pino transport target list. stdout is ALWAYS present — it is the
 * baseline that any infra log shipper (Docker driver, Promtail, CloudWatch
 * agent) scrapes, and it never depends on the aggregator being reachable. When
 * LOKI_URL is set we additionally ship to Grafana Loki via `pino-loki`, which
 * batches in a worker thread so it never blocks the event loop. `silenceErrors`
 * keeps a flaky Loki from spamming the app's own output.
 */
function buildTargets(): pino.TransportTargetOptions[] {
  const targets: pino.TransportTargetOptions[] = [
    isDev
      ? {
          target: "pino-pretty",
          level: env.logLevel,
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname",
          },
        }
      : { target: "pino/file", level: env.logLevel, options: { destination: 1 } }, // stdout
  ];

  if (env.lokiUrl) {
    targets.push({
      target: "pino-loki",
      level: env.logLevel,
      options: {
        host: env.lokiUrl,
        batching: true,
        interval: 5,
        silenceErrors: true,
        labels: { app: "deskly-api", env: env.nodeEnv },
        ...(env.lokiUsername && env.lokiPassword
          ? { basicAuth: { username: env.lokiUsername, password: env.lokiPassword } }
          : {}),
      },
    });
  }
  return targets;
}

/**
 * Single pino instance for the whole app. Structured JSON to stdout everywhere
 * (human-readable via pino-pretty in dev), optionally fanned out to Grafana Loki.
 * In production with no Loki configured we skip the transport machinery entirely
 * and log straight to stdout — the fast, zero-worker path.
 */
const needsTransport = isDev || Boolean(env.lokiUrl);

export const logger = needsTransport
  ? pino({ level: env.logLevel, redact }, pino.transport({ targets: buildTargets() }))
  : pino({ level: env.logLevel, redact });
