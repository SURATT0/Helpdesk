"use client";

import * as React from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useI18n } from "@/features/i18n/context";
import { useArchiveCustomer, useArchiveImpact } from "../queries";
import type { Customer } from "../schemas";

/**
 * Archive a tenant — the end of the desk's relationship with a company.
 *
 * The numbers come from the server's own impact endpoint rather than from the
 * row already on screen. They are the same figures the guard refuses on, read
 * at the moment of asking: a list fetched five minutes ago can say "0 tickets"
 * about a tenant that has since raised one, and a dialog that promises an
 * archive the API then refuses is worse than one that says why up front.
 */
export function ArchiveCustomerDialog({
  customer,
  onClose,
}: {
  customer: Customer;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { data: impact, isLoading } = useArchiveImpact(customer.id);
  const archive = useArchiveCustomer();
  const [error, setError] = React.useState<string | null>(null);

  const blocking =
    impact != null &&
    (impact.projects > 0 || impact.tickets > 0 || impact.users > 0);

  function submit() {
    setError(null);
    archive.mutate(customer.id, {
      onSuccess: onClose,
      onError: (err) =>
        setError(err instanceof ApiError ? err.message : t("customers.archiveError")),
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      label={t("customers.archiveTitle")}
      panelClassName="max-w-[440px]"
    >
      <div className="rounded-xl border border-line bg-panel p-5 shadow-modal">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-dialog font-semibold text-ink">
              {t("customers.archiveTitle")}
            </div>
            <div className="mt-0.5 text-body text-subtle">
              {t("customers.archiveNote", { name: customer.name })}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("customers.archiveClose")}
            className={cn(
              "grid h-7 w-7 flex-none place-items-center rounded-md border border-line text-subtle hover:bg-app",
              TOUCH_TARGET,
            )}
          >
            <X size={14} />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-wash p-3 text-dense text-faint">
            <Loader2 size={13} className="animate-spin" />
            {t("customers.archiveChecking")}
          </div>
        ) : blocking ? (
          // Not a warning to click past: this is the refusal, shown before the
          // request rather than after it, with the counts that cause it.
          <div className="rounded-lg border border-warn-edge bg-warn-tint p-3 text-control">
            <div className="flex items-start gap-1.5 font-semibold text-[#a16207]">
              <AlertTriangle size={14} className="mt-px flex-none" />
              {t("customers.archiveBlocked")}
            </div>
            <ul className="mt-1.5 space-y-0.5 pl-[22px] text-dense text-subtle">
              {impact.tickets > 0 ? (
                <li>{t("customers.archiveOpenTickets", { n: impact.tickets })}</li>
              ) : null}
              {impact.projects > 0 ? (
                <li>{t("customers.archiveProjects", { n: impact.projects })}</li>
              ) : null}
              {impact.users > 0 ? (
                <li>{t("customers.archiveUsers", { n: impact.users })}</li>
              ) : null}
            </ul>
            <p className="mt-2 pl-[22px] text-caption text-faint">
              {t("customers.archiveBlockedHint")}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-wash p-3 text-control text-subtle">
            {/* Says what archiving IS, since it is neither a delete nor a
                hide: the row and its history stay, and the tenant simply
                stops appearing anywhere new work can be filed. */}
            {t("customers.archiveSafe")}
          </div>
        )}

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
            {t("customers.archiveCancel")}
          </Button>
          <Button
            variant="danger"
            onClick={submit}
            disabled={isLoading || blocking || archive.isPending}
          >
            {archive.isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : null}
            {t("customers.archiveConfirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
