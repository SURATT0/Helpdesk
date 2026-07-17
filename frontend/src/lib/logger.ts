/**
 * Tiny client logger. Keeps a consistent shape for app logs and stays quiet in
 * production (only warnings/errors). Swap for a real sink later if needed.
 */
const isDev = process.env.NODE_ENV !== "production";

export const logger = {
  debug: (...args: unknown[]) => {
    if (isDev) console.debug("[deskly]", ...args);
  },
  info: (...args: unknown[]) => {
    if (isDev) console.info("[deskly]", ...args);
  },
  warn: (...args: unknown[]) => console.warn("[deskly]", ...args),
  error: (...args: unknown[]) => console.error("[deskly]", ...args),
};
