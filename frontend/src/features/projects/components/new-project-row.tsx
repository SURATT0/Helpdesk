"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { FIELD_TEXT_12 } from "@/components/ui/input";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { useAuth } from "@/features/auth/context";
import { useCustomers } from "@/features/customers/queries";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";
import { useCreateProject } from "../queries";

/**
 * Inline "add a project" form. Deliberately inline rather than a modal: the name
 * is the only required field, the owner can be picked from the table row once
 * the project exists, and the description can be written on the project's own
 * page whenever somebody has one to write.
 *
 * The description is offered here anyway, optional and collapsed into the same
 * form, because the moment somebody creates a project is the moment they know
 * what it is for. Making them create it and then navigate somewhere else to say
 * so is how projects end up with no description at all.
 */
export function NewProjectRow() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [customerId, setCustomerId] = React.useState<number | null>(null);
  const create = useCreateProject();

  /**
   * Whether this person has to say which customer the project is for.
   *
   * Only somebody who reaches more than one tenant does. A scoped actor's own
   * customer always wins on the server (`resolveProjectCustomerId`), so a picker
   * would be a field with one answer — while a platform-wide admin has NO
   * customer of their own, and the server refuses the create outright without
   * one. That refusal is what made this field necessary rather than nice: the
   * form was unusable for exactly the people who manage every tenant.
   */
  const mustChooseCustomer = user?.platformWide === true;
  const { data: customers = [] } = useCustomers({ enabled: mustChooseCustomer });

  const reset = () => {
    setName("");
    setDescription("");
    setCustomerId(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (mustChooseCustomer && customerId == null) return;
    create.mutate(
      // Empty stays empty rather than becoming an empty string: "nobody has
      // written one" and "somebody wrote nothing" are the same fact, and the
      // server normalises it to null either way.
      {
        name: trimmed,
        description: description.trim() || undefined,
        ...(customerId != null ? { customerId } : {}),
      },
      {
        onSuccess: () => {
          reset();
          setOpen(false);
        },
      },
    );
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-body font-semibold text-white hover:bg-brand-hover"
      >
        <Plus size={14} strokeWidth={2.5} />
        {t("projects.new")}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
      {mustChooseCustomer ? (
        <select
          value={customerId ?? ""}
          onChange={(e) =>
            setCustomerId(e.target.value ? Number(e.target.value) : null)
          }
          aria-label={t("projects.customer")}
          className={cn(
            "min-w-0 rounded-md border border-edge bg-white px-2.5 py-1.5 text-ink sm:w-44",
            "focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15",
            FIELD_TEXT_12,
          )}
        >
          {/* No pre-selected tenant, deliberately: which company a project
              belongs to decides who its tickets route to and who can ever see
              it, and defaulting it would make that the one field nobody read. */}
          <option value="">{t("projects.chooseCustomer")}</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      ) : null}
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("projects.namePlaceholder")}
        maxLength={80}
        // Fluid on a phone — a fixed 224px field plus the two buttons beside it
        // overflowed the row.
        className={cn(
          "w-full min-w-0 rounded-md border border-edge bg-white px-2.5 py-1.5 text-ink sm:w-56",
          "focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15",
          FIELD_TEXT_12,
        )}
      />
      <button
        type="submit"
        disabled={
          !name.trim() ||
          create.isPending ||
          (mustChooseCustomer && customerId == null)
        }
        className="rounded-md bg-brand px-3 py-1.5 text-body font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {create.isPending ? t("projects.saving") : t("projects.create")}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          reset();
          create.reset();
        }}
        aria-label={t("common.cancel")}
        className={cn(
          "grid h-7 w-7 place-items-center rounded-md border border-line text-subtle hover:bg-app",
          TOUCH_TARGET,
        )}
      >
        <X size={14} strokeWidth={2} />
      </button>
      {create.isError ? (
        // Most likely cause is the per-customer unique name, so say so rather
        // than surfacing a raw 4xx.
        <span className="text-dense text-danger">
          {t("projects.createError")}
        </span>
      ) : null}
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t("projects.descriptionPlaceholder")}
        rows={3}
        maxLength={20_000}
        className={cn(
          "w-full min-w-0 rounded-md border border-edge bg-white px-2.5 py-2 text-ink sm:max-w-[520px]",
          "focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15",
          FIELD_TEXT_12,
        )}
      />
      <p className="text-caption text-faint sm:max-w-[520px]">
        {t("projects.descriptionHint")}
      </p>
    </form>
  );
}
