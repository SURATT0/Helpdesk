import { z } from "zod";
import { LIMITS } from "./settings.types";

const MINUTE_MS = 60_000;

/**
 * The settings body.
 *
 * Windows are submitted in MINUTES and stored in milliseconds. The screen asks
 * "how long?" in the unit a person thinks in, and the sweep needs the unit it
 * compares timestamps in; converting at the boundary keeps the millisecond count
 * out of the UI and the minute count out of the query.
 */
export const updateSettingsBody = z.object({
  /** Deny list of event types. Membership is checked against the catalogue in the service. */
  disabledEvents: z.array(z.string().min(1).max(64)).max(64),
  ratePerTicket: z
    .number()
    .int()
    .min(LIMITS.ratePerTicket.min)
    .max(LIMITS.ratePerTicket.max),
  rateWindowMinutes: z
    .number()
    .int()
    .min(LIMITS.rateWindowMinutes.min)
    .max(LIMITS.rateWindowMinutes.max),
  slaWarnMinutes: z
    .number()
    .int()
    .min(LIMITS.slaWarnMinutes.min)
    .max(LIMITS.slaWarnMinutes.max),
});

export type UpdateSettingsBody = z.infer<typeof updateSettingsBody>;

/**
 * Which customer to act on. Optional: a tenant's own manager has exactly one and
 * needs no parameter, while platform-wide staff belong to none and must say.
 */
export const customerQuery = z.object({
  customerId: z.coerce.number().int().positive().optional(),
});

export function toStored(body: UpdateSettingsBody) {
  return {
    disabledEvents: body.disabledEvents,
    ratePerTicket: body.ratePerTicket,
    rateWindowMs: body.rateWindowMinutes * MINUTE_MS,
    slaWarnMs: body.slaWarnMinutes * MINUTE_MS,
  };
}
