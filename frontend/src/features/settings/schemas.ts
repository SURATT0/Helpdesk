import { z } from "zod";

/**
 * The desk's notification policy, as the settings screen reads and writes it.
 *
 * Windows travel as milliseconds on the way in (the server stores what it
 * compares timestamps in) and as minutes on the way out (a person sets "how long
 * before?" in minutes). The conversion lives at this boundary so neither side
 * has to think in the other's unit.
 */
export const notificationSettingsSchema = z.object({
  customerId: z.number(),
  /** Event types NOT mailed. A deny list, so a new event works without an edit. */
  disabledEvents: z.array(z.string()),
  ratePerTicket: z.number(),
  rateWindowMs: z.number(),
  slaWarnMs: z.number(),
  /**
   * False when nothing is stored: the deployment's own defaults are in force.
   * Distinct from "configured to today's defaults" — an unconfigured desk
   * follows the defaults as they change, rather than freezing a copy of them.
   */
  configured: z.boolean(),
  updatedAt: z.string().nullable(),
});

export const limitsSchema = z.object({
  ratePerTicket: z.object({ min: z.number(), max: z.number() }),
  rateWindowMinutes: z.object({ min: z.number(), max: z.number() }),
  slaWarnMinutes: z.object({ min: z.number(), max: z.number() }),
});

export const notificationSettingsEnvelope = z.object({
  data: notificationSettingsSchema,
  /**
   * The server's own vocabulary, so the screen does not keep a second copy of
   * it: the event catalogue to list, and the bounds to put on the inputs. A copy
   * here would drift the first time either changed.
   */
  meta: z.object({ events: z.array(z.string()), limits: limitsSchema }),
});

/** The write response carries no meta — the screen already has it. */
export const notificationSettingsDataEnvelope = z.object({
  data: notificationSettingsSchema,
});

export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type SettingsLimits = z.infer<typeof limitsSchema>;
