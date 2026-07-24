import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  streamNotifications,
} from "./api";

export const notificationKeys = { all: ["notifications"] as const };

export function useNotifications() {
  return useQuery({
    queryKey: notificationKeys.all,
    queryFn: fetchNotifications,
    // Live updates come from the SSE stream (useNotificationStream); this slow
    // poll is just a safety net for anything missed while disconnected.
    refetchInterval: 120_000,
  });
}

/**
 * Keep the bell live: subscribe to the notification SSE stream and refetch the
 * list on each ping. Auto-reconnects with a short backoff if the stream drops.
 * Mount once in the app shell (alongside the bell).
 */
export function useNotificationStream() {
  const qc = useQueryClient();
  React.useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    (async () => {
      while (!stopped) {
        try {
          await streamNotifications(controller.signal, () =>
            qc.invalidateQueries({ queryKey: notificationKeys.all }),
          );
        } catch {
          if (stopped) return;
        }
        if (stopped) return;
        await new Promise((r) => setTimeout(r, 2000)); // backoff, then reconnect
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [qc]);
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => markNotificationRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
