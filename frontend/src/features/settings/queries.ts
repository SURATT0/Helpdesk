"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchNotificationSettings,
  resetNotificationSettings,
  saveNotificationSettings,
  type SaveSettingsInput,
} from "./api";

export const settingsKeys = {
  /**
   * Keyed by tenant, because a policy IS one tenant's. Platform staff switch
   * between customers on the same screen, and a single key would serve them the
   * first customer's answer for the second.
   */
  notifications: (customerId?: number) =>
    ["settings", "notifications", customerId ?? "own"] as const,
  allNotifications: ["settings", "notifications"] as const,
};

export function useNotificationSettings(enabled: boolean, customerId?: number) {
  return useQuery({
    queryKey: settingsKeys.notifications(customerId),
    queryFn: () => fetchNotificationSettings(customerId),
    // Only the top tier may read this, so the query is not even started for
    // anyone else — a 403 in the console is a worse way to say "not for you".
    enabled,
  });
}

export function useSaveNotificationSettings(customerId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveSettingsInput) =>
      saveNotificationSettings(input, customerId),
    onSuccess: () => {
      // The SLA window is part of this, and it decides the colour of every
      // badge on the ticket list — so the tickets have to be refetched too, or
      // the desk would keep showing the old thresholds until something else
      // happened to invalidate them.
      qc.invalidateQueries({ queryKey: settingsKeys.allNotifications });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}

export function useResetNotificationSettings(customerId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => resetNotificationSettings(customerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.allNotifications });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}
