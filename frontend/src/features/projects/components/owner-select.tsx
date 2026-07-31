"use client";

import { useI18n } from "@/features/i18n/context";
import type { User } from "@/features/users/schemas";
import { cn } from "@/lib/utils";

/**
 * Caseworker picker for a project's owner / backup slot.
 *
 * Only staff appear: the API rejects a requester as an owner (they would hold
 * tickets their own row scope cannot see), so offering them would be an error the
 * user can only discover by trying. "Unassigned" maps to null, which clears the
 * slot rather than leaving it untouched.
 */
export function OwnerSelect({
  value,
  users,
  disabled,
  ariaLabel,
  onChange,
}: {
  value: number | null;
  users: User[];
  disabled?: boolean;
  ariaLabel: string;
  onChange: (userId: number | null) => void;
}) {
  const { t } = useI18n();
  const assignable = users.filter((u) => u.role !== "requester");

  return (
    <select
      aria-label={ariaLabel}
      disabled={disabled}
      value={value ?? ""}
      onChange={(e) =>
        onChange(e.target.value === "" ? null : Number(e.target.value))
      }
      className={cn(
        "w-full rounded-md border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-[12.5px] text-ink",
        "focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15",
        disabled && "cursor-not-allowed bg-[#fafbfc] text-faint",
      )}
    >
      <option value="">{t("projects.unassigned")}</option>
      {assignable.map((u) => (
        <option key={u.id} value={u.id}>
          {u.availableForAssignment
            ? u.name
            : `${u.name} — ${t("projects.away")}`}
        </option>
      ))}
    </select>
  );
}
