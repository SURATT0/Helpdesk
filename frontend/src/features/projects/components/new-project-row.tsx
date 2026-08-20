"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { FIELD_TEXT_12 } from "@/components/ui/input";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";
import { useCreateProject } from "../queries";

/**
 * Inline "add a project" form. Deliberately inline rather than a modal: the only
 * required field is a name, and the owner can be picked from the table row once
 * the project exists.
 */
export function NewProjectRow() {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const create = useCreateProject();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          setName("");
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
        className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-hover"
      >
        <Plus size={14} strokeWidth={2.5} />
        {t("projects.new")}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("projects.namePlaceholder")}
        maxLength={80}
        // Fluid on a phone — a fixed 224px field plus the two buttons beside it
        // overflowed the row.
        className={cn(
          "w-full min-w-0 rounded-md border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-ink sm:w-56",
          "focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15",
          FIELD_TEXT_12,
        )}
      />
      <button
        type="submit"
        disabled={!name.trim() || create.isPending}
        className="rounded-md bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {create.isPending ? t("projects.saving") : t("projects.create")}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setName("");
          create.reset();
        }}
        aria-label={t("common.cancel")}
        className={cn(
          "grid h-7 w-7 place-items-center rounded-md border border-line text-[#475569] hover:bg-app",
          TOUCH_TARGET,
        )}
      >
        <X size={14} strokeWidth={2} />
      </button>
      {create.isError ? (
        // Most likely cause is the per-customer unique name, so say so rather
        // than surfacing a raw 4xx.
        <span className="text-[12px] text-[#dc2626]">
          {t("projects.createError")}
        </span>
      ) : null}
    </form>
  );
}
