"use client";

import * as React from "react";
import { Check, Loader2, MailWarning, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FIELD_TEXT_13 } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useCustomers } from "@/features/customers/queries";
import { useI18n } from "@/features/i18n/context";
import { useApproveUser, useRejectUser, useUsers } from "../queries";
import type { User, UserRole } from "../schemas";

/**
 * People waiting to be let in.
 *
 * Above the directory rather than beside it, and hidden entirely when empty:
 * this is a queue, and a queue that is always on screen stops being noticed.
 * When somebody IS waiting it should be the first thing an administrator sees,
 * because it is the only list in the product where a person is blocked until
 * somebody acts.
 *
 * Rendered only for platform-wide staff. That is not a UI decision so much as
 * an acknowledgement of the data: an applicant belongs to no customer yet, so
 * the directory's tenant scope excludes them from everyone else's view and this
 * would render an empty box for a customer's own super admin forever.
 */
export function ApprovalQueue({ canDecide }: { canDecide: boolean }) {
  const { t } = useI18n();
  const { data: pending = [], isLoading } = useUsers({
    enabled: canDecide,
    filters: { status: "pending" },
  });

  if (!canDecide) return null;
  // No box while loading either: a queue that flashes into existence and back
  // out on every page load is worse than one that appears when it has content.
  if (isLoading || pending.length === 0) return null;

  return (
    <section
      aria-labelledby="approval-queue-heading"
      className="mb-6 rounded-panel border border-accent/30 bg-accent-soft/40 p-4 sm:p-5"
    >
      <div className="mb-3 flex items-center gap-2">
        <UserPlus size={16} className="text-[#166534]" />
        <h2
          id="approval-queue-heading"
          className="text-lead font-semibold text-ink"
        >
          {t("approvals.title", { count: pending.length })}
        </h2>
      </div>
      <p className="mb-4 text-body leading-relaxed text-muted">
        {t("approvals.blurb")}
      </p>

      <ul className="flex flex-col gap-3">
        {pending.map((applicant) => (
          <ApplicantRow key={applicant.id} applicant={applicant} />
        ))}
      </ul>
    </section>
  );
}

function ApplicantRow({ applicant }: { applicant: User }) {
  const { t } = useI18n();
  const { data: customers = [] } = useCustomers();
  const approve = useApproveUser();
  const reject = useRejectUser();

  const [customerId, setCustomerId] = React.useState<number | null>(null);
  const [role, setRole] = React.useState<UserRole>("user");
  const [error, setError] = React.useState<string | null>(null);

  // No default customer, on purpose. Every other picker in the app pre-selects
  // its first option to save a click; this one must not, because the click it
  // would save is the decision itself — which company this person is part of.
  const busy = approve.isPending || reject.isPending;

  function onApprove() {
    if (customerId == null) return;
    setError(null);
    approve.mutate(
      { id: applicant.id, customerId, role },
      {
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : t("approvals.error")),
      },
    );
  }

  function onReject() {
    setError(null);
    reject.mutate(
      { id: applicant.id },
      {
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : t("approvals.error")),
      },
    );
  }

  return (
    <li className="rounded-md border border-line bg-panel p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="truncate text-control font-semibold text-ink">
            {applicant.name}
          </div>
          <div className="truncate text-body text-muted">{applicant.email}</div>
          {applicant.emailVerifiedAt == null ? (
            // Worth saying out loud rather than leaving to be noticed: approving
            // an unconfirmed address is approving an address nobody has checked
            // belongs to the person asking. It does not block the decision —
            // that is the administrator's to make — but they should make it
            // knowing.
            <div className="mt-1.5 flex items-center gap-1.5 text-caption font-medium text-danger-ink">
              <MailWarning size={13} />
              {t("approvals.unverified")}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1">
            <span className="text-caption font-medium text-faint">
              {t("approvals.customer")}
            </span>
            <select
              value={customerId ?? ""}
              onChange={(e) =>
                setCustomerId(e.target.value ? Number(e.target.value) : null)
              }
              disabled={busy}
              className={cn(
                "rounded-md border border-edge bg-white px-2.5 py-2 text-ink",
                FIELD_TEXT_13,
                "sm:w-[170px]",
              )}
            >
              <option value="">{t("approvals.choose")}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-caption font-medium text-faint">
              {t("approvals.role")}
            </span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              disabled={busy}
              className={cn(
                "rounded-md border border-edge bg-white px-2.5 py-2 text-ink",
                FIELD_TEXT_13,
                "sm:w-[140px]",
              )}
            >
              <option value="user">{t("role.user")}</option>
              <option value="admin">{t("role.admin")}</option>
              <option value="super_admin">{t("role.super_admin")}</option>
            </select>
          </label>

          <div className="flex gap-2">
            <Button
              onClick={onApprove}
              // Disabled until a customer is chosen — the form cannot succeed
              // without one, and the server would refuse it.
              disabled={busy || customerId == null}
              className="gap-1.5"
            >
              {approve.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
              {t("approvals.approve")}
            </Button>
            <Button
              variant="secondary"
              onClick={onReject}
              disabled={busy}
              className="gap-1.5"
            >
              {reject.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <X size={14} />
              )}
              {t("approvals.reject")}
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-dense font-medium text-danger-ink">
          {error}
        </p>
      ) : null}
    </li>
  );
}
