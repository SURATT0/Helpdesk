import type { TicketStatus } from "@/lib/domain";
import { isFinished } from "@/lib/ticket-status";
import { formatDuration, type DurationLabels } from "./duration";

/**
 * What a ticket's SLA clock currently says, judged on the client from the stored
 * timestamps (`dueAt` / `resolvedAt`) rather than from the server's `slaDue`
 * string.
 *
 * Why not just use `slaState` from the API: it has five values and `danger`
 * conflates three different situations — overdue and still open, due within the
 * hour, and closed after the target. The list needs to tell those apart, and it
 * needs the *magnitude* of an overrun, which the server's `slaDue` throws away
 * (`formatRemaining` clamps negatives, so everything late reads "0h 0m",
 * whether it missed by five minutes or five days).
 *
 * `slaDue`/`slaState` remain the server's authoritative snapshot; this is the
 * same judgement made against a live clock.
 */
export const SLA_STATES = [
  "breached_open",
  "at_risk",
  "due_soon",
  "on_track",
  "breached_closed",
  "met",
  "no_sla",
] as const;
export type SlaState = (typeof SLA_STATES)[number];

/**
 * The states with something still at stake, worst first — the same order the
 * SLA column sorts in.
 *
 * `met` and `no_sla` are left out: they are the states with nothing to act on.
 * Two places want exactly this subset — the filter facet, because narrowing is
 * for work that needs doing, and the badge, which reads a duration out to a
 * screen reader only when there is one. They each kept their own copy of the
 * list, so a new state reached one and not the other.
 */
export const SLA_STATES_AT_STAKE = [
  "breached_open",
  "at_risk",
  "due_soon",
  "on_track",
  "breached_closed",
] as const satisfies readonly SlaState[];

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Two levels of warning, deliberately mirroring backend/src/modules/tickets/sla.ts
 * (SLA_DANGER_MS / SLA_WARN_MS). The 4h tier exists because that is when the
 * server's sweep actually emails an SLA warning — collapsing it into "on track"
 * would show a calm grey row for a ticket the system has already escalated.
 */
export const AT_RISK_MS = HOUR_MS;
export const DUE_SOON_MS = 4 * HOUR_MS;

export type SlaAssessment = {
  state: SlaState;
  /**
   * Minutes of headroom against the target: positive = time left, negative =
   * overrun, and null when there is no target to measure against. Measured from
   * now while the clock runs, and from `resolvedAt` once the ticket is finished.
   */
  minutesDelta: number | null;
  /** Ready to render, e.g. "2h 14m over" / "42m left" / "missed by 3d". */
  label: string;
};

/**
 * The words the label is built from. Injected rather than read from the
 * dictionary for the same reason `formatDuration` does it: this stays a pure
 * function with no React context behind it. `{d}` is replaced by the formatted
 * duration.
 */
export type SlaLabels = {
  units: DurationLabels;
  /** Overdue and still open — "{d} over". */
  over: string;
  /** Still running — "{d} left". */
  left: string;
  /** Finished late — "missed by {d}". */
  missed: string;
  met: string;
  /** No SLA target on this ticket. */
  none: string;
};

export type SlaInput = {
  dueAt: string | null;
  status: TicketStatus;
  /**
   * When the work actually finished. The backend judges met/breached from this
   * the moment a ticket is *resolved*, without waiting for it to close, so this
   * does too — otherwise the list and the reports would disagree.
   */
  resolvedAt: string | null;
};

/**
 * Judge one ticket's SLA. `now` is injectable so callers can tick a shared clock
 * (and so tests don't depend on the wall clock).
 *
 * There is no paused state, and no paused-duration input, because there is no
 * paused clock: an SLA policy in the spec is `{ first_response_mins,
 * resolution_mins }` with nothing to stop it, and `due_at` is computed once at
 * creation and never moved. `pending` used to get a "Paused, clock stopped"
 * badge, which was false in the one direction that matters — a ticket sitting on
 * the requester went past its target showing the same calm grey as one with a day
 * of headroom, and only turned red once somebody resumed it.
 *
 * Waiting on the requester is what the ticket's *status* says. What this says is
 * how it is doing against a target that runs either way.
 */
export function assessSla(
  ticket: SlaInput,
  labels: SlaLabels,
  now: number = Date.now(),
): SlaAssessment {
  const { state, minutesDelta } = judgeSla(ticket, now);
  return { state, minutesDelta, label: describe(state, minutesDelta, labels) };
}

/**
 * The verdict without the words. Split out because the filter needs the state
 * and nothing else — dragging the dictionary into `matchesFilters` to throw the
 * label away would be backwards.
 */
export function judgeSla(
  { dueAt, status, resolvedAt }: SlaInput,
  now: number = Date.now(),
): Omit<SlaAssessment, "label"> {
  const due = dueAt ? Date.parse(dueAt) : NaN;
  if (Number.isNaN(due)) return { state: "no_sla", minutesDelta: null };

  // Finished: pending means the work is done and `resolved_at` is stamped, so
  // there is a verdict rather than a countdown. Same rule as the API's deriveSla,
  // and `isFinished` is where that rule lives on this side.
  if (isFinished(status)) {
    const done = resolvedAt ? Date.parse(resolvedAt) : NaN;
    // No recorded finish time leaves nothing to judge against; the backend calls
    // that "met" rather than inventing a breach, and so do we.
    if (Number.isNaN(done)) return { state: "met", minutesDelta: null };
    const delta = minutesBetween(due, done);
    return {
      state: delta >= 0 ? "met" : "breached_closed",
      minutesDelta: delta,
    };
  }

  const minutesDelta = minutesBetween(due, now);
  const remainingMs = due - now;
  if (remainingMs < 0) return { state: "breached_open", minutesDelta };
  const state: SlaState =
    remainingMs < AT_RISK_MS
      ? "at_risk"
      : remainingMs < DUE_SOON_MS
        ? "due_soon"
        : "on_track";
  return { state, minutesDelta };
}

function describe(
  state: SlaState,
  minutesDelta: number | null,
  labels: SlaLabels,
): string {
  const ms = Math.abs(minutesDelta ?? 0) * MINUTE_MS;
  switch (state) {
    case "breached_open":
      return fill(labels.over, ms, labels.units);
    case "breached_closed":
      return fill(labels.missed, ms, labels.units);
    case "at_risk":
    case "due_soon":
    case "on_track":
      return fill(labels.left, ms, labels.units);
    case "met":
      return labels.met;
    case "no_sla":
      return labels.none;
  }
}

/**
 * Signed minutes of headroom, rounded towards zero so a target one second away
 * reads as 0 rather than as a minute in hand.
 */
function minutesBetween(due: number, reference: number): number {
  return Math.trunc((due - reference) / MINUTE_MS);
}

function fill(template: string, ms: number, units: DurationLabels): string {
  return template.replace("{d}", formatDuration(ms, units));
}

/**
 * Sort order for the SLA column: worst first. Everything with a running clock
 * leads, ordered by how badly it has overrun or how close it is to breaching;
 * finished tickets sink to the bottom, where nothing is at stake.
 *
 * A `pending` ticket sorts by its clock like any other running one — it used to
 * land in a bucket of its own, below tickets that were already closed, which put
 * the least visible breaches furthest down the page.
 */
const SORT_BUCKET: Record<SlaState, number> = {
  breached_open: 0,
  at_risk: 0,
  due_soon: 0,
  on_track: 0,
  breached_closed: 1,
  met: 2,
  no_sla: 3,
};

export function compareSla(a: SlaAssessment, b: SlaAssessment): number {
  const bucket = SORT_BUCKET[a.state] - SORT_BUCKET[b.state];
  if (bucket !== 0) return bucket;
  // Within a bucket: most negative (most overdue) first.
  return (a.minutesDelta ?? Number.POSITIVE_INFINITY) -
    (b.minutesDelta ?? Number.POSITIVE_INFINITY);
}
