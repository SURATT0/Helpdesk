"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchNotificationSettings,
  resetNotificationSettings,
  saveNotificationSettings,
  type SaveSettingsInput,
} from "./api";

export const settingsKeys = {
  notifications: ["settings", "notifications"] as const,
};

export function useNotificationSettings(enabled: boolean) {
  return useQuery({
    queryKey: settingsKeys.notifications,
    queryFn: fetchNotificationSettings,
    // Only the top tier may read this, so the query is not even started for
    // anyone else — a 403 in the console is a worse way to say "not for you".
    enabled,
  });
}

export function useSaveNotificationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveSettingsInput) => saveNotificationSettings(input),
    onSuccess: () => {
      // The SLA window is part of this, and it decides the colour of every
      // badge on the ticket list — so the tickets have to be refetched too, or
      // the desk would keep showing the old thresholds until something else
      // happened to invalidate them.
      qc.invalidateQueries({ queryKey: settingsKeys.notifications });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}

export function useResetNotificationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => resetNotificationSettings(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.notifications });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}
