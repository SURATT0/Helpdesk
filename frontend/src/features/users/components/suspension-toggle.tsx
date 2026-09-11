"use client";

import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";
import type { UserStatus } from "../schemas";

/**
 * Suspend an account, or lift a suspension.
 *
 * A SECOND off-switch beside `AccountToggle`, which is a thing to justify rather
 * than assume. They stop the same person signing in and are still not the same
 * control:
 *
 *   closing   (`isActive: false`) says the person has LEFT. The server refuses it
 *             while they still hold open tickets — the queue has to be handed
 *             over first, which is right for a departure and takes a conversation.
 *   suspending(`status: suspended`) says stop, now. No handover, because the
 *             cases that need it — an account behaving oddly, somebody under
 *             investigation — are exactly the ones where waiting to redistribute
 *             a queue is the wrong order to do things in.
 *
 * So the fast one has no guard and is reversible in one click, and the permanent
 * one keeps its guard. Rendered as a quiet text button rather than a second
 * checkbox, so the column does not read as two equal switches.
 *
 * Only `active` and `suspended` are reachable here. `pending` and `rejected`
 * belong to the approval queue, and the server refuses them on this path — an
 * account must not be pushable back into a queue it has already been through.
 */
export function SuspensionToggle({
  status,
  canEdit,
  isSelf,
  pending,
  onChange,
}: {
  status: UserStatus;
  canEdit: boolean;
  isSelf: boolean;
  pending?: boolean;
  onChange: (next: "active" | "suspended") => void;
}) {
  const { t } = useI18n();

  // Nothing to offer on a row the queue owns: an applicant is decided in the
  // queue above, and a rejected one is not suspended, it was never let in.
  if (status === "pending" || status === "rejected") return null;
  // Suspending yourself is a locked-out administrator and a support call. The
  // server refuses it; this just does not offer it.
  if (!canEdit || isSelf) return null;

  const suspended = status === "suspended";
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => onChange(suspended ? "active" : "suspended")}
      className={cn(
        "mt-0.5 text-caption font-medium underline-offset-2 hover:underline disabled:cursor-wait disabled:opacity-60",
        suspended ? "text-accent" : "text-faint hover:text-danger-ink",
      )}
    >
      {suspended ? t("users.reinstate") : t("users.suspend")}
    </button>
  );
}
