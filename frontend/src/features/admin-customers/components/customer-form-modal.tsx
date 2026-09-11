"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD_TEXT_13 } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useI18n } from "@/features/i18n/context";
import { useCreateCustomer, useRenameCustomer } from "@/features/customers/queries";
import type { Customer } from "@/features/customers/schemas";

/**
 * Add a customer, or rename one. One form, because it is one field.
 *
 * A modal rather than the inline row the old table used: this screen's left pane
 * is a list of names and the right is a detail, and there is no row to grow a
 * field inside. It also means the same control works at 375px, where an inline
 * input beside two buttons was what overflowed.
 *
 * The shell — portal, backdrop, Escape, focus trap, body-scroll lock — is
 * `Dialog`'s. What is here is the form and, more importantly, what happens when
 * the server says no: the message is the SERVER's, because it distinguishes a
 * live namesake from an archived one and that difference is the whole value of
 * it. An archived namesake is solved by reviving a row this list does not
 * contain, and "that name is taken" would send somebody hunting through a list
 * it is not in.
 */
export function CustomerFormModal({
  open,
  /** The customer being renamed, or null when adding one. */
  customer,
  onClose,
  onCreated,
}: {
  open: boolean;
  customer: Customer | null;
  onClose: () => void;
  /** So the caller can select what was just added. */
  onCreated?: (id: number) => void;
}) {
  const { t } = useI18n();
  const create = useCreateCustomer();
  const rename = useRenameCustomer();
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const titleId = "customer-form-title";

  const editing = customer != null;
  const busy = create.isPending || rename.isPending;

  // Refilled on each open rather than on close, so a refused submit keeps what
  // was typed: the person is being told the name collides, and clearing it under
  // them would make them retype it to find out what else collides.
  React.useEffect(() => {
    if (open) {
      setName(customer?.name ?? "");
      setError(null);
    }
  }, [open, customer]);

  const trimmed = name.trim();
  const ready =
    trimmed.length >= 2 && !busy && (!editing || trimmed !== customer.name);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    const onError = (err: unknown) =>
      setError(
        err instanceof ApiError
          ? err.message
          : t(editing ? "customers.renameError" : "customers.createError"),
      );

    if (editing) {
      rename.mutate(
        { id: customer.id, name: trimmed },
        { onSuccess: onClose, onError },
      );
    } else {
      create.mutate(trimmed, {
        onSuccess: (created) => {
          onCreated?.(created.id);
          onClose();
        },
        onError,
      });
    }
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      labelledBy={titleId}
      panelClassName="max-h-[80vh] max-w-[440px] overflow-hidden rounded-panel border border-line bg-panel shadow-modal"
    >
      {/* Head and foot fixed, middle scrolling — so the confirm button cannot be
          pushed below the fold on a short screen. One field cannot do that
          today; the error notice under it can. */}
      <form onSubmit={submit} className="flex max-h-[80vh] flex-col">
        <div className="flex-none border-b border-hairline px-4 py-3 sm:px-5 sm:py-4">
          <h2 id={titleId} className="text-section font-semibold text-ink">
            {editing ? t("adminCustomers.renameTitle") : t("adminCustomers.newTitle")}
          </h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <label htmlFor="customer-name" className="mb-1.5 block text-dense font-medium text-subtle">
            {t("adminCustomers.nameLabel")}
          </label>
          <input
            id="customer-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            maxLength={120}
            className={cn(
              "w-full rounded-md border border-edge bg-white px-3 py-2.5 text-ink",
              FIELD_TEXT_13,
              "focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15",
            )}
          />
          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-md border border-danger-edge bg-danger-bg px-3 py-2.5 text-body font-medium text-danger-ink"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-none flex-col-reverse gap-2 border-t border-hairline px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!ready} className="gap-1.5">
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            {editing ? t("adminCustomers.saveName") : t("adminCustomers.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
