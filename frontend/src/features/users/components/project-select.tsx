"use client";

import { FIELD_TEXT_12 } from "@/components/ui/input";
import { useI18n } from "@/features/i18n/context";
import type { Project } from "@/features/projects/schemas";
import { cn } from "@/lib/utils";

/**
 * Puts a user into a routing project (or takes them out with "None").
 *
 * Only lists projects the caller can see, which the API already scopes to their
 * own customer — attaching a user to another tenant's project is refused
 * server-side, so it must not be offered here.
 */
export function ProjectSelect({
  value,
  projects,
  disabled,
  ariaLabel,
  onChange,
}: {
  value: number | null;
  projects: Project[];
  disabled?: boolean;
  ariaLabel: string;
  onChange: (projectId: number | null) => void;
}) {
  const { t } = useI18n();

  return (
    <select
      aria-label={ariaLabel}
      disabled={disabled}
      value={value ?? ""}
      onChange={(e) =>
        onChange(e.target.value === "" ? null : Number(e.target.value))
      }
      className={cn(
        "w-full rounded-md border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-ink",
        // A <select> zooms iOS just like a text field does.
        FIELD_TEXT_12,
        "focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15",
        disabled && "cursor-not-allowed bg-[#fafbfc] text-faint",
      )}
    >
      <option value="">{t("users.noProject")}</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
