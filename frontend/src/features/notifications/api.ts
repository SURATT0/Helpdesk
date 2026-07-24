import { API_BASE_URL, ApiError, apiRequest } from "@/lib/api-client";
import { tokenStore } from "@/features/auth/token-store";
import { notificationListSchema, type Notification } from "./schemas";

export async function fetchNotifications(): Promise<{
  items: Notification[];
  unread: number;
}> {
  const body = await apiRequest("/notifications");
  const parsed = notificationListSchema.parse(body);
  return { items: parsed.data, unread: parsed.meta.unread };
}

export async function markNotificationRead(id: number): Promise<void> {
  await apiRequest(`/notifications/${id}/read`, { method: "POST" });
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiRequest("/notifications/read-all", { method: "POST" });
}

/**
 * Subscribe to the caller's notification stream over SSE (fetch, so the in-memory
 * bearer token can be a header). `onNotify` fires on each server ping — the
 * caller refetches the list. Resolves on stream end; throws on a failed
 * connection so the caller can reconnect.
 */
export async function streamNotifications(
  signal: AbortSignal,
  onNotify: () => void,
): Promise<void> {
  const token = tokenStore.get();
  const res = await fetch(`${API_BASE_URL}/notifications/stream`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "include",
    signal,
  });
  if (!res.ok || !res.body) {
    throw new ApiError(res.status, "STREAM_ERROR", "Notification stream failed");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (frame.split("\n").some((l) => l.startsWith("event: notification"))) {
        onNotify();
      }
    }
  }
}
