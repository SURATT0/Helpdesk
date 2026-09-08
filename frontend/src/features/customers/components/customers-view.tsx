"use client";

import * as React from "react";
import { Archive, Info, Loader2, Plus, ShieldAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { FIELD_TEXT_12 } from "@/components/ui/input";
import { LoadingRow, ErrorState, EmptyState } from "@/components/ui/states";
import { TableScroll } from "@/components/ui/table-scroll";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { ApiError } from "@/lib/api-client";
import { holds } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import {
  useCreateCustomer,
  useCustomers,
  useRenameCustomer,
} from "../queries";
import type { Customer } from "../schemas";
import { ArchiveCustomerDialog } from "./archive-customer-dialog";

/**
 * Two grids, with and without the actions column — the same arrangement the
 * projects table uses. A reader who cannot archive must not be left looking at
 * a gutter where somebody else's button lives.
 */
const COLS = "grid-cols-[1.6fr_110px_110px_110px]";
const COLS_WITH_ACTIONS = "grid-cols-[1.6fr_110px_110px_110px_44px]";

export function CustomersView() {
  const { t } = useI18n();
  const { user } = useAuth();

  // Mirrors the server. The list itself is open to anyone authenticated (it only
  // ever names tenants you already work in), but a requester has no use for a
  // page of one row they cannot act on, so the screen starts at admin.
  const canRead = user != null && user.role !== "user";
  // Creating and renaming: admin and above, as agreed. It confers no reach —
  // see `customerService.mayManage`.
  const canManage =
    user != null && (user.role === "admin" || user.role === "super_admin");
  /**
   * Archiving is its own grant, read through the shared permission table rather
   * than compared against a role name here. Held by no role explicitly, so only
   * a super admin's `*` satisfies it — the same arrangement `project:delete`
   * uses, and deliberately stricter than creating.
   */
  const canArchive = user != null && holds(user.role, "customer:archive");

  const { data: customers = [], isLoading, isError, refetch } = useCustomers({
    enabled: canRead,
  });
  const [archiving, setArchiving] = React.useState<Customer | null>(null);

  if (!canRead) {
    return (
      <>
        <Topbar titleKey="nav.customers" showSearch={false} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-line bg-panel p-10 text-center">
            <ShieldAlert size={22} className="text-faint" />
            <div className="text-lead font-semibold text-ink">
              {t("customers.forbidden")}
            </div>
            <div className="max-w-[46ch] text-body text-subtle">
              {t("customers.forbiddenNote")}
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Topbar titleKey="nav.customers" showSearch={false} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <p className="flex max-w-[62ch] items-start gap-2 text-body leading-relaxed text-subtle">
            <Info size={14} className="mt-[2px] flex-none text-faint" />
            {t("customers.explainer")}
          </p>
          {canManage ? <NewCustomerRow /> : null}
        </div>

        <div className="overflow-hidden rounded-lg border border-line bg-panel">
          <TableScroll minWidth={canArchive ? 640 : 596}>
            <div
              className={cn(
                "grid items-center border-b border-hairline bg-wash px-4 py-2.5 text-caption font-semibold tracking-columns text-faint",
                canArchive ? COLS_WITH_ACTIONS : COLS,
              )}
            >
              <span>{t("customers.col.name")}</span>
              <span>{t("customers.col.projects")}</span>
              <span>{t("customers.col.tickets")}</span>
              <span>{t("customers.col.users")}</span>
              {canArchive ? <span /> : null}
            </div>

            {isLoading ? <LoadingRow label={t("customers.loading")} /> : null}
            {isError ? (
              <ErrorState
                message={t("customers.loadError")}
                onRetry={() => refetch()}
              />
            ) : null}
            {!isLoading && !isError && customers.length === 0 ? (
              <EmptyState message={t("customers.empty")} />
            ) : null}

            {customers.map((c, i) => (
              <div
                key={c.id}
                className={cn(
                  "grid items-center px-4 py-3 text-control",
                  canArchive ? COLS_WITH_ACTIONS : COLS,
                  i < customers.length - 1 && "border-b border-rule",
                )}
              >
                <NameCell customer={c} canEdit={canManage} />
                <span className="text-body text-subtle">{c.counts.projects}</span>
                <span className="text-body text-subtle">{c.counts.tickets}</span>
                <span className="text-body text-subtle">{c.counts.users}</span>
                {canArchive ? (
                  <button
                    type="button"
                    onClick={() => setArchiving(c)}
                    aria-label={t("customers.archiveFor", { name: c.name })}
                    className={cn(
                      "grid place-items-center rounded-md text-faint hover:bg-app hover:text-danger",
                      TOUCH_TARGET,
                    )}
                  >
                    <Archive size={14} />
                  </button>
                ) : null}
              </div>
            ))}
          </TableScroll>
        </div>
      </main>

      {archiving ? (
        <ArchiveCustomerDialog
          customer={archiving}
          onClose={() => setArchiving(null)}
        />
      ) : null}
    </>
  );
}

/**
 * The name, editable in place for someone who may rename.
 *
 * In place rather than in a dialog: renaming a tenant is a one-field correction
 * — a typo, a company that rebranded — and a modal for one text box is more
 * ceremony than the act deserves. Committed on blur or Enter, abandoned on Esc.
 */
function NameCell({
  customer,
  canEdit,
}: {
  customer: Customer;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const rename = useRenameCustomer();
  const [draft, setDraft] = React.useState(customer.name);
  const [error, setError] = React.useState<string | null>(null);

  // Follow the server's answer when it differs from what was typed — another
  // tab, or a trim.
  React.useEffect(() => setDraft(customer.name), [customer.name]);

  if (!canEdit) {
    return (
      <span className="truncate pr-3 font-medium text-ink">{customer.name}</span>
    );
  }

  function commit() {
    const next = draft.trim();
    if (!next || next === customer.name) {
      setDraft(customer.name);
      setError(null);
      return;
    }
    setError(null);
    rename.mutate(
      { id: customer.id, name: next },
      {
        onError: (err) => {
          setError(err instanceof ApiError ? err.message : t("customers.renameError"));
          setDraft(customer.name);
        },
      },
    );
  }

  return (
    <span className="min-w-0 pr-3">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(customer.name);
            setError(null);
            e.currentTarget.blur();
          }
        }}
        aria-label={t("customers.renameFor", { name: customer.name })}
        className={cn(
          "w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1.5 py-1 font-medium text-ink hover:border-line focus:border-brand focus:outline-none",
          FIELD_TEXT_12,
        )}
      />
      {error ? (
        <span className="mt-0.5 block truncate text-caption text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** Add a tenant. One field, because a customer is a name until it has work. */
function NewCustomerRow() {
  const { t } = useI18n();
  const create = useCreateCustomer();
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    create.mutate(trimmed, {
      onSuccess: () => setName(""),
      onError: (err) =>
        // The server distinguishes a live namesake from an archived one, and
        // that difference is the whole value of the message — an archived one
        // is solved by restoring a row this list does not contain.
        setError(err instanceof ApiError ? err.message : t("customers.createError")),
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="new-customer">
          {t("customers.newName")}
        </label>
        <input
          id="new-customer"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("customers.newName")}
          className={cn(
            "w-[220px] rounded-md border border-line bg-white px-2.5 py-1.5 text-ink placeholder:text-faint focus:border-brand focus:outline-none",
            FIELD_TEXT_12,
          )}
        />
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          {create.isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Plus size={13} strokeWidth={2.5} />
          )}
          {t("customers.add")}
        </Button>
      </div>
      {error ? (
        <span className="max-w-[42ch] text-right text-caption text-danger">
          {error}
        </span>
      ) : null}
    </form>
  );
}
