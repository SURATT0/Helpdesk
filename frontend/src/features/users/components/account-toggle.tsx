"use client";

import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";

/**
 * Whether the account may be used at all — the switch for someone who has left.
 *
 * Kept visually apart from the availability control beside it, because the two
 * are easy to confuse and only one of them is reversible without a conversation:
 * availability is a rota, this is the door. Closed reads in the breach colour,
 * open reads as plain text rather than a badge, so an open directory is quiet and
 * the closed rows are the ones that catch the eye.
 *
 * A checkbox rather than a styled div, so it is keyboard- and screen-reader
 * operable for free. Read-only viewers still see the state: an agent looking at
 * the directory should know why a colleague is no longer picking anything up.
 *
 * `disabled` covers the cases the server would refuse anyway — your own account,
 * which would lock you out. The server is still the gate; this only avoids
 * offering a control that cannot work.
 */
export function AccountToggle({
  active,
  canEdit,
  disabled,
  pending,
  ariaLabel,
  onChange,
}: {
  active: boolean;
  canEdit: boolean;
  disabled?: boolean;
  pending?: boolean;
  ariaLabel: string;
  onChange: (next: boolean) => void;
}) {
  const { t } = useI18n();
  const label = active ? t("users.account.active") : t("users.account.closed");

  if (!canEdit || disabled) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-[2px] text-caption font-semibold",
          active
            ? "text-subtle"
            : "bg-sla-risk-bg text-sla-breach-fg",
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
        checked={active}
        disabled={pending}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer accent-accent"
      />
      <span
        className={cn(
          "font-medium",
          active ? "text-subtle" : "font-semibold text-sla-breach-fg",
        )}
      >
        {label}
      </span>
    </label>
  );
}
