import { apiRequest } from "@/lib/api-client";
import {
  notificationSettingsDataEnvelope,
  notificationSettingsEnvelope,
  type NotificationSettings,
  type SettingsLimits,
} from "./schemas";

const MINUTE_MS = 60_000;

export type SettingsPayload = {
  settings: NotificationSettings;
  events: string[];
  limits: SettingsLimits;
};

export async function fetchNotificationSettings(): Promise<SettingsPayload> {
  const body = await apiRequest("/settings/notifications");
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
): Promise<NotificationSettings> {
  const body = await apiRequest("/settings/notifications", {
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
export async function resetNotificationSettings(): Promise<NotificationSettings> {
  const body = await apiRequest("/settings/notifications", { method: "DELETE" });
  return notificationSettingsDataEnvelope.parse(body).data;
}

export const toMinutes = (ms: number): number => Math.round(ms / MINUTE_MS);
