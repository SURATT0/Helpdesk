"use client";

import * as React from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { StatusBadge, PriorityIndicator } from "@/components/ui/status-badge";
import { useI18n } from "@/features/i18n/context";
import { useUsers } from "@/features/users/queries";
import type { Priority, TicketStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { useBulkTicketAction, type BulkAction } from "../queries";

const STATUSES: TicketStatus[] = [
  "new",
  "open",
  "in_progress",
  "pending",
  "resolved",
  "closed",
];
const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];
const ASSIGNABLE_ROLES = ["admin", "manager", "agent"];

function Menu({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-sm border border-[#334155] px-2.5 py-1.5 hover:bg-[#1e293b] disabled:opacity-50"
      >
        {label}
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-20 mb-1 max-h-[240px] min-w-[170px] overflow-y-auto rounded-md border border-line bg-white py-1 text-ink shadow-modal">
            {children(() => setOpen(false))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-app"
    >
      {children}
    </button>
  );
}

export function BulkActionBar({
  selectedIds,
  onClear,
}: {
  selectedIds: number[];
  onClear: () => void;
}) {
  const { t } = useI18n();
  const bulk = useBulkTicketAction();
  const { data: users = [] } = useUsers();
  const [note, setNote] = React.useState<string | null>(null);

  const staff = users.filter((u) => ASSIGNABLE_ROLES.includes(u.role));

  function apply(action: BulkAction) {
    setNote(null);
    bulk.mutate(
      { ids: selectedIds, action },
      {
        onSuccess: (res) => {
          if (res.failed === 0) {
            onClear();
          } else {
            setNote(
              t("bulk.result", {
                ok: res.total - res.failed,
                failed: res.failed,
              }),
            );
          }
        },
      },
    );
  }

  return (
    <div className="flex items-center gap-3.5 bg-ink px-4 py-2.5 text-[12.5px] text-[#e2e8f0]">
      <span className="font-semibold">
        {t("bulk.selected", { n: selectedIds.length })}
      </span>

      <div className="flex items-center gap-2">
        <Menu label={t("bulk.assign")} disabled={bulk.isPending}>
          {(close) => (
            <>
              <MenuItem
                onClick={() => {
                  close();
                  apply({ kind: "assignee", assigneeId: null });
                }}
              >
                <span className="italic text-faint">{t("bulk.unassigned")}</span>
              </MenuItem>
              {staff.map((u) => (
                <MenuItem
                  key={u.id}
                  onClick={() => {
                    close();
                    apply({ kind: "assignee", assigneeId: u.id });
                  }}
                >
                  {u.name}
                </MenuItem>
              ))}
            </>
          )}
        </Menu>

        <Menu label={t("bulk.status")} disabled={bulk.isPending}>
          {(close) =>
            STATUSES.map((s) => (
              <MenuItem
                key={s}
                onClick={() => {
                  close();
                  apply({ kind: "status", status: s });
                }}
              >
                <StatusBadge status={s} />
              </MenuItem>
            ))
          }
        </Menu>

        <Menu label={t("bulk.priority")} disabled={bulk.isPending}>
          {(close) =>
            PRIORITIES.map((p) => (
              <MenuItem
                key={p}
                onClick={() => {
                  close();
                  apply({ kind: "priority", priority: p });
                }}
              >
                <PriorityIndicator priority={p} />
              </MenuItem>
            ))
          }
        </Menu>
      </div>

      {bulk.isPending ? (
        <span className="flex items-center gap-1.5 text-faint">
          <Loader2 size={13} className="animate-spin" />
          {t("bulk.applying")}
        </span>
      ) : note ? (
        <span className="font-medium text-[#fca5a5]">{note}</span>
      ) : null}

      <button
        onClick={onClear}
        className={cn("ml-auto text-faint hover:text-white")}
      >
        {t("bulk.clear")}
      </button>
    </div>
  );
}
