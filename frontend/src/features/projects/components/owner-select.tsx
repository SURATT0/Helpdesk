"use client";

import { FIELD_TEXT_12 } from "@/components/ui/input";
import { useI18n } from "@/features/i18n/context";
import type { User } from "@/features/users/schemas";
import { canHoldWorkFor } from "@/lib/assignment";
import { cn } from "@/lib/utils";

/**
 * Caseworker picker for a project's owner / backup slot.
 *
 * Only staff appear: the API rejects a requester as an owner (they would hold
 * tickets their own row scope cannot see), so offering them would be an error the
 * user can only discover by trying. "Unassigned" maps to null, which clears the
 * slot rather than leaving it untouched.
 *
 * Deliberately plain names, with no "away" annotation. This picker answers "who is
 * responsible", a standing decision; whether that person happens to be away today
 * is their own state, set on the users page, and it changes far more often than
 * project ownership does. Mixing the two here invited reshuffling owners over a
 * temporary absence, which is what the backup slot already exists to handle. The
 * consequence of an absence is still stated per row, where it belongs: the routing
 * line under the project name names whoever the next ticket actually lands on.
 */
export function OwnerSelect({
  value,
  users,
  customerId,
  disabled,
  ariaLabel,
  onChange,
}: {
  value: number | null;
  users: User[];
  /** The PROJECT's customer — whose work this slot hands out. */
  customerId: number;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (userId: number | null) => void;
}) {
  const { t } = useI18n();
  // Staff who can actually see this customer's tickets. It used to filter on
  // the role alone, which for a platform-wide viewer meant every tenant's
  // staff — and the server agreed, because its check asked about the caller
  // rather than about the work. See `canHoldWorkFor`.
  const assignable = users.filter((u) => canHoldWorkFor(u, customerId));

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
      <option value="">{t("projects.unassigned")}</option>
      {assignable.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </select>
  );
}
