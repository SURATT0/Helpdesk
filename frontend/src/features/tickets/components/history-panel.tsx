"use client";

import { STATUS_META } from "@/lib/domain";
import { useI18n } from "@/features/i18n/context";
import { useTicketHistory } from "../queries";

const fmt = (iso: string, lang: string) =>
  new Date(iso).toLocaleString(lang === "th" ? "th-TH" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function HistoryPanel({ ticketId }: { ticketId: number }) {
  const { t, lang } = useI18n();
  const { data: entries = [], isLoading } = useTicketHistory(ticketId);

  if (isLoading) {
    return <div className="text-[11.5px] text-faint">{t("common.loading")}</div>;
  }
  if (entries.length === 0) {
    return <div className="text-[11.5px] text-faint">{t("history.empty")}</div>;
  }

  return (
    <div className="flex flex-col text-[11.5px] text-muted">
      {entries.map((h, i) => {
        const meta = STATUS_META[h.toStatus];
        const label =
          h.fromStatus === null
            ? t("history.created")
            : t(`status.${h.toStatus}`);
        const last = i === entries.length - 1;
        return (
          <div key={h.id} className="grid grid-cols-[14px_1fr] gap-2.5">
            <div className="flex flex-col items-center">
              <span
                className="mt-[3px] h-2 w-2 rounded-full"
                style={{ background: meta.fg }}
              />
              {!last ? <span className="w-[1.5px] flex-1 bg-line" /> : null}
            </div>
            <div className={last ? "" : "pb-3"}>
              <strong className="text-[#334155]">{label}</strong> ·{" "}
              {h.actor ?? t("history.system")} · {fmt(h.createdAt, lang)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
