import { apiRequest } from "@/lib/api-client";
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
