import { env } from "../../config/env";
import { SLA_WARN_MS } from "../tickets/sla";
import type { EmailEvent } from "../emails/email.events";

/**
 * One customer's notification policy, with every value resolved.
 *
 * "Effective" is the operative word: a customer may have no stored row at all,
 * and several may have a row that says nothing about a given field. Every reader
 * wants a complete answer, so resolution happens once, here, rather than each
 * caller remembering its own fallback.
 */
export type EffectiveSettings = {
  /** Event types this customer does not want mailed. */
  disabledEvents: ReadonlySet<string>;
  /** Mails per (ticket, recipient) inside the window before collapsing. */
  ratePerTicket: number;
  rateWindowMs: number;
  /** How long before `due_at` a ticket reads as "due soon". */
  slaWarnMs: number;
  /** False when nothing is stored — the deployment defaults are in force. */
  configured: boolean;
};

/**
 * What a customer gets before anyone has configured them: the deployment's own
 * defaults.
 *
 * Read fresh on each call rather than captured once, because `env` is mutated by
 * tests and the defaults are meant to follow it.
 */
export function deploymentDefaults(): EffectiveSettings {
  return {
    disabledEvents: env.ticketEmail.disabledEvents,
    ratePerTicket: env.ticketEmail.ratePerTicket,
    rateWindowMs: env.ticketEmail.rateWindowMs,
    slaWarnMs: SLA_WARN_MS,
    configured: false,
  };
}

/** The stored shape, as the repository reads and writes it. */
export type StoredSettings = {
  disabledEvents: string[];
  ratePerTicket: number;
  rateWindowMs: number;
  slaWarnMs: number;
};

/** What the settings screen shows and submits. */
export type SettingsDto = StoredSettings & {
  customerId: number;
  configured: boolean;
  updatedAt: string | null;
};

/**
 * Bounds every stored value has to sit inside.
 *
 * Not decoration: a rate limit of 0 would silence a desk without saying so, and
 * an SLA warning window longer than the shortest SLA target would mark every
 * ticket at risk the moment it was raised, which is the same as marking none.
 * The validators read these, and so does the settings screen's help text.
 */
export const LIMITS = {
  ratePerTicket: { min: 1, max: 50 },
  rateWindowMinutes: { min: 1, max: 24 * 60 },
  slaWarnMinutes: { min: 5, max: 7 * 24 * 60 },
} as const;

export function isKnownEvent(value: string, known: readonly EmailEvent[]): boolean {
  return (known as readonly string[]).includes(value);
}
