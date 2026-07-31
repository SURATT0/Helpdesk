import type { Priority, TicketStatus } from "../../shared/domain";

/**
 * SLA presentation logic. `slaDue` (e.g. "1h 20m") and `slaState` are COMPUTED
 * for the API response — never stored. The stored source of truth is the
 * ticket's `due_at` (set at creation from the policy below) plus the
 * append-only ticket_status_history rows.
 *
 * NOTE: these per-priority resolution targets are placeholder defaults —
 * reconcile against the SLA policy in the architecture design doc before this
 * is treated as authoritative.
 */
export type SlaState = "danger" | "warn" | "ok" | "paused" | "met";

/** Resolution target in hours, by priority. */
export const SLA_POLICY: Record<Priority, number> = {
  critical: 4,
  high: 8,
  medium: 24,
  low: 48,
};

const HOUR_MS = 60 * 60 * 1000;

/**
 * Urgency thresholds on the time remaining until `due_at`. ONE definition drives
 * both the read-time badge (`deriveSla`) and the background alert sweep
 * (`slaAlertKind`), so what the UI calls "at risk" is exactly what triggers a
 * notification — they cannot drift apart.
 */
export const SLA_DANGER_MS = HOUR_MS;
export const SLA_WARN_MS = 4 * HOUR_MS;

/** Statuses whose SLA clock is running — the only ones an alert can apply to. */
export const SLA_ACTIVE_STATUSES = [
  "new",
  "open",
  "in_progress",
] as const satisfies readonly TicketStatus[];

/** Due timestamp for a ticket created at `createdAt` with the given priority. */
export function computeDueAt(priority: Priority, createdAt: Date): Date {
  return new Date(createdAt.getTime() + SLA_POLICY[priority] * HOUR_MS);
}

export function formatRemaining(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
}

/**
 * Derive the display SLA fields from stored state.
 * - pending           → clock paused
 * - resolved / closed  → met if it was resolved on or before `due_at`, else breached
 * - active statuses    → time left until `due_at`, coloured by urgency
 */
export function deriveSla(
  status: TicketStatus,
  dueAt: Date | null,
  now: Date,
  resolvedAt: Date | null = null,
): { slaDue: string; slaState: SlaState } {
  if (status === "pending") return { slaDue: "paused", slaState: "paused" };
  if (status === "resolved" || status === "closed") {
    // Compare the actual resolution time to the target. Fall back to "met" only
    // when there's no target or no recorded resolution time to judge against.
    if (dueAt && resolvedAt) {
      return resolvedAt.getTime() <= dueAt.getTime()
        ? { slaDue: "met", slaState: "met" }
        : { slaDue: "breached", slaState: "danger" };
    }
    return { slaDue: "met", slaState: "met" };
  }
  if (!dueAt) return { slaDue: "—", slaState: "ok" };

  const remainingMs = dueAt.getTime() - now.getTime();
  const state: SlaState =
    remainingMs < SLA_DANGER_MS
      ? "danger"
      : remainingMs < SLA_WARN_MS
        ? "warn"
        : "ok";
  return { slaDue: formatRemaining(remainingMs), slaState: state };
}

/** What kind of alert a running SLA clock currently deserves, if any. */
export type SlaAlertKind = "warning" | "breach";

/**
 * Decide whether a ticket's SLA clock warrants a notification right now.
 *
 * Pure and separate from `deriveSla` because the two answer different questions:
 * `deriveSla` colours a badge on every read, while this decides whether to
 * *interrupt someone*. It deliberately reuses the same thresholds so the two
 * agree. Returns null when the clock is comfortable — the caller then writes
 * nothing.
 *
 * Callers must have already excluded paused (`pending`) and finished
 * (`resolved`/`closed`) tickets; see SLA_ACTIVE_STATUSES.
 */
export function slaAlertKind(
  dueAt: Date | null,
  now: Date,
): SlaAlertKind | null {
  if (!dueAt) return null;
  const remainingMs = dueAt.getTime() - now.getTime();
  if (remainingMs <= 0) return "breach";
  return remainingMs <= SLA_WARN_MS ? "warning" : null;
}
