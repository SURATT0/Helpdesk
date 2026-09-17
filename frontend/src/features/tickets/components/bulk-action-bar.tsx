"use client";

import * as React from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { StatusBadge, PriorityIndicator } from "@/components/ui/status-badge";
import { useI18n } from "@/features/i18n/context";
import { useUsers } from "@/features/users/queries";
import { canHoldWorkFor } from "@/lib/assignment";
import { PRIORITIES } from "@/lib/domain";
import { DB_STATUSES, type TicketStatus } from "@/lib/ticket-status";
import { cn } from "@/lib/utils";
import { useBulkTicketAction, type BulkAction } from "../queries";
import { ResolutionDialog } from "./resolution-dialog";

// The three STORED values — a bulk write sends `status`, so this menu offers
// what a write may carry. "In Progress" is absent because it is derived: it is
// `new` with an assignee, which the Assign menu beside this one is for.
// Every stored value the DESK may set. `cancelled` is absent because it is not
// the desk's move — withdrawing a request belongs to the person who made it, and
// the API refuses the value on the route this bar fans out to.
const STATUSES = DB_STATUSES.filter((s) => s !== "cancelled");
const ASSIGNABLE_ROLES = ["super_admin", "admin"];

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
        className="inline-flex items-center gap-1 rounded-sm border border-strong px-2.5 py-1.5 hover:bg-[#1e293b] disabled:opacity-50"
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
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body hover:bg-app"
    >
      {children}
    </button>
  );
}

export function BulkActionBar({
  selectedIds,
  selectedCustomerIds,
  onClear,
}: {
  selectedIds: number[];
  /**
   * Every customer the selection covers — usually one, and more than one only
   * for a reader who can see across tenants.
   */
  selectedCustomerIds: number[];
  onClear: () => void;
}) {
  const { t } = useI18n();
  const bulk = useBulkTicketAction();
  const { data: users = [] } = useUsers();
  const [note, setNote] = React.useState<string | null>(null);
  // Which destination the resolution dialog is collecting for, or null when shut.
  const [resolving, setResolving] = React.useState<TicketStatus | null>(null);

  /**
   * Who may be handed this selection.
   *
   * The role alone is not the question, and the API stopped pretending it was:
   * a ticket may only go to somebody who can SEE it, so a selection spanning
   * two customers can only go to someone who reaches both — in practice
   * platform staff. Filtered here so a name in this menu is a name that works,
   * rather than one that comes back 403 after the click.
   *
   * `every` over an empty list is true, which is the right fallback: a
   * selection whose rows carry no customer (nothing does today) degrades to the
   * old role-only offer and lets the server answer.
   */
  const staff = users.filter(
    (u) =>
      ASSIGNABLE_ROLES.includes(u.role) &&
      selectedCustomerIds.every((customerId) => canHoldWorkFor(u, customerId)),
  );

  function apply(action: BulkAction) {
    setNote(null);
    bulk.mutate(
      { ids: selectedIds, action },
      {
        onSuccess: (res) => {
          setResolving(null);
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

  /**
   * A bulk status change asks for a resolution whenever the destination is one
   * a finish can land on — `pending` or `closed`.
   *
   * It cannot do better than "whenever", because the selection is a set of ids
   * and this bar never loaded their rows: whether any given ticket is making a
   * move that requires text is a question about its CURRENT status, which only
   * the server knows. So the text is collected for the whole batch and sent
   * with every patch; the server writes it on the tickets that were finished by
   * this move and drops it on the rest (a `pending` ticket in the selection
   * being confirmed closed keeps the resolution whoever did the work wrote).
   *
   * Asking once for the batch is also the right shape for the case that
   * produces a bulk close — one incident, many tickets, one account of the fix.
   * `new` is not asked: reopening and sending back finish nothing.
   */
  function chooseStatus(status: TicketStatus) {
    if (status === "new") {
      apply({ kind: "status", status });
      return;
    }
    setNote(null);
    setResolving(status);
  }

  return (
    <div className="flex items-center gap-3.5 bg-ink px-4 py-2.5 text-body text-edge">
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
                  chooseStatus(s);
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

      {resolving ? (
        <ResolutionDialog
          target={resolving}
          count={selectedIds.length}
          busy={bulk.isPending}
          error={null}
          onCancel={() => setResolving(null)}
          onSubmit={(resolution) =>
            apply({ kind: "status", status: resolving, resolution })
          }
        />
      ) : null}
    </div>
  );
}
