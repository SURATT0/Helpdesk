"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useNotificationStream,
} from "@/features/notifications/queries";
import type { Notification } from "@/features/notifications/schemas";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";

function timeAgo(iso: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return t("time.justNow");
  if (min < 60) return t("time.minAgo", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("time.hrAgo", { n: hr });
  return t("time.dayAgo", { n: Math.floor(hr / 24) });
}

export function NotificationsBell() {
  const router = useRouter();
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const { data } = useNotifications();
  useNotificationStream(); // live bell updates over SSE (replaces the 30s poll)
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  function openNotification(n: Notification) {
    if (!n.readAt) markRead.mutate(n.id);
    setOpen(false);
    if (n.ticketId) router.push(`/tickets/${n.ticketId}`);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative grid h-[34px] w-[34px] place-items-center rounded-md border border-line text-[#475569] hover:bg-app"
        aria-label={t("topbar.notifications")}
      >
        <Bell size={16} strokeWidth={2} />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#dc2626] px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-[340px] overflow-hidden rounded-lg border border-line bg-white shadow-modal">
            <div className="flex items-center justify-between border-b border-[#eef1f5] px-4 py-2.5">
              <span className="text-[13px] font-bold text-ink">
                {t("topbar.notifications")}
              </span>
              {unread > 0 ? (
                <button
                  type="button"
                  onClick={() => markAll.mutate()}
                  className="text-[12px] font-semibold text-brand hover:text-brand-hover"
                >
                  {t("notif.markAll")}
                </button>
              ) : null}
            </div>

            <div className="max-h-[380px] overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-4 py-8 text-center text-[12.5px] text-faint">
                  {t("notif.empty")}
                </div>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => openNotification(n)}
                    className={cn(
                      "flex w-full items-start gap-2.5 border-b border-[#f1f4f8] px-4 py-3 text-left hover:bg-[#fafbfc]",
                      !n.readAt && "bg-[#eff7f2]",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 flex-none rounded-full",
                        n.readAt ? "bg-transparent" : "bg-brand",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] leading-snug text-[#334155]">
                        {n.message}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-faint">
                        {timeAgo(n.createdAt, t)}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
