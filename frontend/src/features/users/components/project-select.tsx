"use client";

import { FIELD_TEXT_12 } from "@/components/ui/input";
import { useI18n } from "@/features/i18n/context";
import type { Project } from "@/features/projects/schemas";
import { cn } from "@/lib/utils";

/**
 * Puts a user into a routing project (or takes them out with "None").
 *
 * Lists what it is given, and what it must be given is **the projects of the
 * customer THIS USER belongs to** — see the grouping in the users page.
 *
 * It used to be handed every project the caller could see, on the argument that
 * the API scopes those to the caller's own customer and refuses the rest. That
 * held for a customer-bound caller and failed for platform staff, who see every
 * tenant's — and the server's check was keyed on the caller too, so the screen
 * and the gate agreed about something that was not true. A requester at one
 * company could be pointed at another company's routing, and
 * `findRoutingForRequester` reads that column with no customer check of its
 * own: their next ticket would be assigned to somebody who cannot see it.
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
        "w-full rounded-md border border-edge bg-white px-2.5 py-1.5 text-ink",
        // A <select> zooms iOS just like a text field does.
        FIELD_TEXT_12,
        "focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15",
        disabled && "cursor-not-allowed bg-wash text-faint",
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
