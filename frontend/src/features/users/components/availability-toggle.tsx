"use client";

import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";

/**
 * The away switch. `available` means routed work still comes to this person; off
 * makes project routing fall through to the backup owner.
 *
 * Rendered as a real checkbox rather than a styled div so it is keyboard- and
 * screen-reader-operable for free. When `canEdit` is false it degrades to a
 * badge — an agent viewing the directory should still see who is away, since
 * that explains where tickets are going.
 */
export function AvailabilityToggle({
  available,
  canEdit,
  pending,
  ariaLabel,
  onChange,
}: {
  available: boolean;
  canEdit: boolean;
  pending?: boolean;
  ariaLabel: string;
  onChange: (next: boolean) => void;
}) {
  const { t } = useI18n();
  const label = available ? t("users.available") : t("users.away");

  if (!canEdit) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-[2px] text-caption font-semibold",
          available
            ? "bg-status-resolved-bg text-status-resolved-fg"
            : "bg-status-pending-bg text-status-pending-fg",
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 text-dense",
        pending && "cursor-wait opacity-60",
      )}
    >
      <input
        type="checkbox"
        aria-label={ariaLabel}
        checked={available}
        disabled={pending}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer accent-accent"
      />
      <span
        className={cn(
          "font-medium",
          available ? "text-subtle" : "text-status-pending-fg",
        )}
      >
        {label}
      </span>
    </label>
  );
}
