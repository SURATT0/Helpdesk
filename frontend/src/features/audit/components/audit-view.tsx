"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Info, ShieldAlert } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { FIELD_TEXT_12 } from "@/components/ui/input";
import { LoadingRow, ErrorState, EmptyState } from "@/components/ui/states";
import { TableScroll } from "@/components/ui/table-scroll";
import { toneForName } from "@/features/tickets/data";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";
import { useAuditActions, useAuditLog } from "../queries";
import type { AuditEntry } from "../schemas";

const PAGE_SIZE = 50;

const COLS = "grid-cols-[150px_1.1fr_170px_90px_1fr]";

/** Colour the action family so a long trail is scannable at a glance. */
const FAMILY_STYLE: Record<string, { fg: string; bg: string }> = {
  ticket: { fg: "#0369a1", bg: "#e0f2fe" },
  comment: { fg: "#15803d", bg: "#dcfce7" },
  user: { fg: "#6d28d9", bg: "#ede9fe" },
  project: { fg: "#b45309", bg: "#fef3c7" },
  problem: { fg: "#be123c", bg: "#ffe4e6" },
  asset: { fg: "#0f766e", bg: "#ccfbf1" },
  attachment: { fg: "#475569", bg: "#f1f5f9" },
};
const DEFAULT_STYLE = { fg: "#475569", bg: "#f1f5f9" };

const familyOf = (action: string) => action.split(".")[0] ?? action;

const formatWhen = (iso: string, lang: string) =>
  new Date(iso).toLocaleString(lang === "th" ? "th-TH" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Render the per-action `meta` blob compactly. Shape varies by action and is
 * intentionally untyped on the API, so this stays defensive: objects become
 * `key: value` pairs, anything else is stringified, and nothing is assumed.
 */
function MetaCell({ meta }: { meta: unknown }) {
  if (meta == null || (typeof meta === "object" && !Object.keys(meta).length)) {
    return <span className="text-faint">—</span>;
  }
  if (typeof meta !== "object") {
    return <span className="truncate text-[12px]">{String(meta)}</span>;
  }
  const pairs = Object.entries(meta as Record<string, unknown>);
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {pairs.map(([k, v]) => (
        <span key={k} className="text-[11.5px] text-[#475569]">
          <span className="text-faint">{k}:</span>{" "}
          <span className="font-medium">
            {v == null
              ? "—"
              : typeof v === "object"
                ? JSON.stringify(v)
                : String(v)}
          </span>
        </span>
      ))}
    </span>
  );
}

function Row({ entry, last }: { entry: AuditEntry; last: boolean }) {
  const { t, lang } = useI18n();
  const style = FAMILY_STYLE[familyOf(entry.action)] ?? DEFAULT_STYLE;
  return (
    <div
      className={cn(
        "grid items-center px-4 py-2.5 text-[13px]",
        COLS,
        !last && "border-b border-[#f1f4f8]",
      )}
    >
      <span className="text-[12px] text-faint">
        {formatWhen(entry.createdAt, lang)}
      </span>

      <span className="min-w-0">
        <span
          className="inline-flex max-w-full items-center truncate rounded-full px-2 py-[3px] font-mono text-[11px] font-semibold"
          style={{ color: style.fg, background: style.bg }}
        >
          {entry.action}
        </span>
      </span>

      <span className="min-w-0">
        {entry.actor ? (
          <span className="flex items-center gap-2">
            <Avatar
              name={entry.actor.name}
              tone={toneForName(entry.actor.name)}
              size={22}
            />
            <span className="truncate text-[12.5px] font-medium text-ink">
              {entry.actor.name}
            </span>
          </span>
        ) : (
          // No session behind the write — e.g. a requester created from email.
          <span className="text-[12px] italic text-faint">
            {t("audit.system")}
          </span>
        )}
      </span>

      <span className="text-[12px] text-[#475569]">
        {entry.entity}
        {entry.entityId != null ? (
          <span className="text-faint"> #{entry.entityId}</span>
        ) : null}
      </span>

      <MetaCell meta={entry.meta} />
    </div>
  );
}

export function AuditView() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [action, setAction] = React.useState("");
  const [offset, setOffset] = React.useState(0);

  // Mirrors the server's audit:read grant. The API is the real gate; this only
  // avoids firing a request that would be refused.
  const canRead = user?.role === "super_admin";

  const filter = React.useMemo(
    () => ({ action: action || undefined, limit: PAGE_SIZE, offset }),
    [action, offset],
  );
  const { data, isLoading, isError, refetch } = useAuditLog(filter);
  const { data: actions = [] } = useAuditActions({ enabled: canRead });

  if (!canRead) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-line bg-panel p-10 text-center">
        <ShieldAlert size={22} className="text-faint" />
        <div className="text-[13.5px] font-semibold text-ink">
          {t("audit.forbidden")}
        </div>
        <div className="max-w-[46ch] text-[12.5px] text-[#475569]">
          {t("audit.forbiddenNote")}
        </div>
      </div>
    );
  }

  const entries = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = offset + entries.length;
  // Families, so "ticket" filters every ticket.* action via the prefix match.
  const families = [...new Set(actions.map(familyOf))].sort();

  return (
    <>
      <p className="mb-4 flex max-w-[78ch] items-start gap-2 text-[12.5px] leading-relaxed text-[#475569]">
        <Info size={14} className="mt-[2px] flex-none text-faint" />
        {t("audit.explainer")}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-[12px] font-medium text-faint" htmlFor="audit-action">
          {t("audit.filterAction")}
        </label>
        <select
          id="audit-action"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setOffset(0); // a new filter invalidates the current page window
          }}
          className={cn(
            "rounded-md border border-line bg-white px-2.5 py-1.5 text-ink",
            FIELD_TEXT_12,
          )}
        >
          <option value="">{t("audit.allActions")}</option>
          {families.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        {action ? (
          <button
            type="button"
            onClick={() => {
              setAction("");
              setOffset(0);
            }}
            className="rounded-md border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-[#475569] hover:bg-app"
          >
            {t("filter.clear")}
          </button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        <TableScroll minWidth={980}>
            <div
              className={cn(
                "grid items-center border-b border-[#eef1f5] bg-[#fafbfc] px-4 py-2.5 text-[11.5px] font-semibold tracking-[0.02em] text-faint",
                COLS,
              )}
            >
              <span>{t("audit.col.when")}</span>
              <span>{t("audit.col.action")}</span>
              <span>{t("audit.col.actor")}</span>
              <span>{t("audit.col.entity")}</span>
              <span>{t("audit.col.detail")}</span>
            </div>

            {isLoading ? <LoadingRow label={t("audit.loading")} /> : null}
            {isError ? (
              <ErrorState
                message={t("audit.loadError")}
                onRetry={() => refetch()}
              />
            ) : null}
            {!isLoading && !isError && entries.length === 0 ? (
              <EmptyState message={t("audit.empty")} />
            ) : null}

            {entries.map((e, i) => (
              <Row key={e.id} entry={e} last={i === entries.length - 1} />
            ))}
        </TableScroll>
      </div>

      {total > 0 ? (
        <div className="mt-3 flex items-center justify-between text-[12.5px] text-[#475569]">
          <span>{t("audit.range", { from, to, total })}</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              disabled={offset === 0}
              className="flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 font-semibold text-[#475569] hover:bg-app disabled:opacity-40"
            >
              <ChevronLeft size={13} />
              {t("audit.prev")}
            </button>
            <button
              type="button"
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              disabled={to >= total}
              className="flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 font-semibold text-[#475569] hover:bg-app disabled:opacity-40"
            >
              {t("audit.next")}
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
