import { apiRequest } from "@/lib/api-client";
import {
  notificationSettingsDataEnvelope,
  notificationSettingsEnvelope,
  type NotificationSettings,
  type SettingsLimits,
} from "./schemas";

const MINUTE_MS = 60_000;

/**
 * Name the tenant, when the caller has to.
 *
 * A policy belongs to one customer. Staff who belong to one themselves never
 * say which — the API reads it off them — but platform staff belong to none, so
 * for them the API asks, and answers 400 if nobody says. There is deliberately
 * no default: quietly picking a tenant would be one company's settings being
 * edited from another's screen.
 */
function withCustomer(path: string, customerId?: number): string {
  return customerId == null ? path : `${path}?customerId=${customerId}`;
}

export type SettingsPayload = {
  settings: NotificationSettings;
  events: string[];
  limits: SettingsLimits;
};

export async function fetchNotificationSettings(
  customerId?: number,
): Promise<SettingsPayload> {
  const body = await apiRequest(withCustomer("/settings/notifications", customerId));
  const { data, meta } = notificationSettingsEnvelope.parse(body);
  return { settings: data, events: meta.events, limits: meta.limits };
}

export type SaveSettingsInput = {
  disabledEvents: string[];
  ratePerTicket: number;
  /** Minutes — the unit the form is in. Converted for the API here. */
  rateWindowMinutes: number;
  slaWarnMinutes: number;
};

export async function saveNotificationSettings(
  input: SaveSettingsInput,
  customerId?: number,
): Promise<NotificationSettings> {
  const body = await apiRequest(withCustomer("/settings/notifications", customerId), {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return notificationSettingsDataEnvelope.parse(body).data;
}

/**
 * Back to the deployment defaults. A delete rather than a save of today's
 * default values, so the desk follows the defaults as they change instead of
 * pinning a copy of them.
 */
export async function resetNotificationSettings(
  customerId?: number,
): Promise<NotificationSettings> {
  const body = await apiRequest(withCustomer("/settings/notifications", customerId), {
    method: "DELETE",
  });
  return notificationSettingsDataEnvelope.parse(body).data;
}

export const toMinutes = (ms: number): number => Math.round(ms / MINUTE_MS);
