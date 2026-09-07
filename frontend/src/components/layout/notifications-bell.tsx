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
import { TOUCH_TARGET } from "@/components/ui/touch";
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

  // Escape closes it on both layouts. A panel you can open with one tap and only
  // close by aiming at the backdrop is the complaint this started from.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Freeze the page behind — but only where this is a MODAL. Above `md` it is
  // still a dropdown, and a dropdown that stops the page scrolling would be a
  // new bug rather than a fix. Restores the previous value instead of clearing
  // it, so opening this over another modal cannot leave the body stuck.
  React.useEffect(() => {
    if (!open) return;
    if (window.matchMedia("(min-width: 768px)").matches) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

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
        className={cn(
          "relative grid h-[34px] w-[34px] place-items-center rounded-md border border-line text-subtle hover:bg-app",
          TOUCH_TARGET,
        )}
        aria-label={t("topbar.notifications")}
      >
        <Bell size={16} strokeWidth={2} />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-counter font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          {/* Tinted where this is a modal, invisible where it is a dropdown —
              a scrim behind a dropdown would dim the whole app for a menu. */}
          <div
            className="fixed inset-0 z-40 bg-ink/20 md:bg-transparent"
            onClick={() => setOpen(false)}
          />
          {/* Below md: a real modal, centred on the VIEWPORT rather than hung
              off the bell. Anchored, it was cut off by the right edge on a
              phone and the messages could not be read to the end.
              From md up: the original dropdown, unchanged.

              340px is the design's width, but it is not a floor: anchored to
              the right edge of a topbar with px-4, a fixed 340 hangs ~36px off
              the LEFT edge of a 320px screen — and leftward overflow is not
              scrollable, so the document-width check in mobile-tables.spec.ts
              cannot see it. `min()` gives it the width it has room for. */}
          <div className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-white shadow-modal md:absolute md:left-auto md:top-auto md:mt-2 md:block md:max-h-none md:w-[min(340px,calc(100vw-2rem))] md:translate-x-0 md:translate-y-0 md:right-0">
            <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
              <span className="text-control font-bold text-ink">
                {t("topbar.notifications")}
              </span>
              {unread > 0 ? (
                <button
                  type="button"
                  onClick={() => markAll.mutate()}
                  className="text-dense font-semibold text-brand hover:text-brand-hover"
                >
                  {t("notif.markAll")}
                </button>
              ) : null}
            </div>

            {/* As a modal the list takes whatever the 80vh panel has left, so
                the header stays put while the list scrolls; as a dropdown it
                keeps its own 380px cap. */}
            <div className="min-h-0 flex-1 overflow-y-auto md:max-h-[380px] md:flex-none">
              {items.length === 0 ? (
                <div className="px-4 py-8 text-center text-body text-faint">
                  {t("notif.empty")}
                </div>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => openNotification(n)}
                    className={cn(
                      "flex w-full items-start gap-2.5 border-b border-rule px-4 py-3 text-left hover:bg-wash",
                      !n.readAt && "bg-accent-tint",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 flex-none rounded-full",
                        n.readAt ? "bg-transparent" : "bg-brand",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body leading-snug text-strong">
                        {n.message}
                      </span>
                      <span className="mt-0.5 block text-meta text-faint">
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
