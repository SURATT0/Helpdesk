"use client";

import * as React from "react";
import { Building2, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useCustomers } from "@/features/customers/queries";
import { useI18n } from "@/features/i18n/context";
import { useSetUserReach } from "../queries";
import type { User } from "../schemas";

/**
 * Which customers this person may work BEYOND the one they belong to.
 *
 * Deliberately not a column. The directory already carries nine and scrolls
 * horizontally on a phone at 1110px; a tenth for a field that is empty on
 * almost every row would cost every reader width to show nothing. It sits under
 * the name instead, where it reads as a fact about the person, and appears at
 * all only when there is something to say or someone who can say it.
 *
 * Granting is platform-wide only. `canGrant` decides whether to OFFER the
 * control — the server checks for itself, and a viewer who cannot grant still
 * sees the chips, because "Dana also covers Globex" explains why she turns up
 * in another tenant's tickets.
 */
export function CustomerAccess({
  user,
  canGrant,
}: {
  user: User;
  canGrant: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);

  if (user.reach.length === 0 && !canGrant) return null;
  // A requester sees only their own tickets whatever reach says, so offering
  // the control here would be offering a setting that does nothing — the
  // server refuses it with exactly that reason.
  if (user.role === "user") return null;

  const summary =
    user.reach.length === 0
      ? t("reach.none")
      : user.reach.map((c) => c.name).join(", ");

  return (
    <>
      {canGrant ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("reach.editFor", { name: user.name })}
          className={cn(
            "mt-0.5 inline-flex max-w-full items-center gap-1 rounded text-caption text-faint hover:text-brand-hover hover:underline",
            user.reach.length > 0 && "text-subtle",
          )}
        >
          <Building2 size={11} className="flex-none" />
          <span className="truncate">{summary}</span>
        </button>
      ) : (
        <span className="mt-0.5 inline-flex max-w-full items-center gap-1 text-caption text-subtle">
          <Building2 size={11} className="flex-none" />
          <span className="truncate">{summary}</span>
        </span>
      )}
      {open ? (
        <CustomerAccessModal user={user} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function CustomerAccessModal({
  user,
  onClose,
}: {
  user: User;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const setReach = useSetUserReach();
  const { data: customers = [], isLoading } = useCustomers();
  const [error, setError] = React.useState<string | null>(null);
  // Local until saved, so ticking three boxes is one request rather than three
  // — and so a mistake can be unticked before it reaches anyone's reach.
  const [picked, setPicked] = React.useState<Set<number>>(
    () => new Set(user.reach.map((c) => c.id)),
  );

  // Their own customer is not a grant and cannot be taken away, so it is shown
  // as context rather than as a box to untick.
  const home = user.customer;
  const grantable = customers.filter((c) => c.id !== home?.id);

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save() {
    setError(null);
    setReach.mutate(
      { id: user.id, customerIds: [...picked] },
      {
        onSuccess: onClose,
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : t("reach.error")),
      },
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      label={t("reach.title")}
      panelClassName="max-w-[420px]"
    >
      <div className="rounded-xl border border-line bg-panel p-5 shadow-modal">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-dialog font-semibold text-ink">
              {t("reach.title")}
            </div>
            <div className="mt-0.5 text-body text-subtle">
              {t("reach.note", { name: user.name })}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("reach.close")}
            className={cn(
              "grid h-7 w-7 flex-none place-items-center rounded-md border border-line text-subtle hover:bg-app",
              TOUCH_TARGET,
            )}
          >
            <X size={14} />
          </button>
        </div>

        {home ? (
          <div className="rounded-lg border border-line bg-wash px-3 py-2 text-dense text-subtle">
            {t("reach.belongsTo", { customer: home.name })}
          </div>
        ) : null}

        <div className="mt-3 max-h-[280px] overflow-y-auto rounded-lg border border-line">
          {isLoading ? (
            <div className="flex items-center gap-2 p-3 text-dense text-faint">
              <Loader2 size={13} className="animate-spin" />
              {t("reach.loading")}
            </div>
          ) : grantable.length === 0 ? (
            <div className="p-3 text-dense text-faint">
              {t("reach.noOtherCustomers")}
            </div>
          ) : (
            grantable.map((c) => (
              <label
                key={c.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 border-b border-hairline px-3 py-2.5 text-control last:border-b-0 hover:bg-wash",
                  TOUCH_TARGET,
                )}
              >
                <input
                  type="checkbox"
                  checked={picked.has(c.id)}
                  onChange={() => toggle(c.id)}
                  className="h-4 w-4 flex-none accent-brand"
                />
                <span className="truncate text-ink">{c.name}</span>
              </label>
            ))
          )}
        </div>

        {/* Not a caveat to bury: the person's own session keeps the reach it was
            signed with until their token is renewed, so "why can't they see it
            yet" has an answer on screen rather than in a support call. */}
        <p className="mt-3 text-caption leading-relaxed text-faint">
          {t("reach.tokenLag")}
        </p>

        {error ? (
          <div
            role="alert"
            className="mt-3 rounded-md border border-danger-edge bg-danger-bg px-3 py-2 text-dense font-medium text-danger-ink"
          >
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("reach.cancel")}
          </Button>
          <Button onClick={save} disabled={setReach.isPending}>
            {setReach.isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : null}
            {t("reach.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
