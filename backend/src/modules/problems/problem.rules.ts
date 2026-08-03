import type { ProblemStatus } from "./problem.types";

/** The subset of a problem's state these rules reason about. */
export type ProblemState = {
  status: ProblemStatus;
  workaround: string | null;
};

/**
 * Apply a partial edit to the current state, so the rules below judge the
 * RESULT rather than the request. A field that isn't in the patch keeps its
 * stored value — otherwise "set status to known_error" would look like it has no
 * workaround even when one was saved last week.
 */
export function nextProblemState(
  current: ProblemState,
  patch: Partial<ProblemState>,
): ProblemState {
  return {
    status: patch.status ?? current.status,
    workaround:
      patch.workaround !== undefined ? patch.workaround : current.workaround,
  };
}

/** Whether a workaround field counts as filled in (not null, not whitespace). */
export function hasWorkaround(state: ProblemState): boolean {
  return (state.workaround ?? "").trim().length > 0;
}

/**
 * Validate the state a problem would be left in. Returns an error message, or
 * null when the state is coherent.
 *
 * ONE rule, and it is the one that makes "known error" mean something: a problem
 * may only be marked `known_error` when a workaround is actually written down.
 * That is what the status promises — an agent seeing it expects an interim fix to
 * exist — and without the check the status becomes a label with nothing behind
 * it, which is the state this codebase was already in.
 *
 * Deliberately NOT a transition whitelist. Ticket statuses have one because the
 * spec defines it; the problem lifecycle has no documented order, and inventing
 * one would block legitimate paths (a problem can genuinely go straight from
 * `investigating` to `resolved` when the root cause turns out to be a one-line
 * config fix). Every change is recorded in the audit trail instead.
 */
export function validateProblemState(state: ProblemState): string | null {
  if (state.status === "known_error" && !hasWorkaround(state)) {
    return "A problem can only be marked known_error once it has a workaround — document the interim fix first";
  }
  return null;
}

/**
 * Whether this edit is the moment a workaround becomes available to the people
 * working the linked incidents — i.e. worth interrupting them for.
 *
 * True on the transition INTO `known_error`, not on every later edit of an
 * already-known error, so correcting a typo in a workaround doesn't re-notify.
 */
export function announcesWorkaround(
  current: ProblemState,
  next: ProblemState,
): boolean {
  return (
    next.status === "known_error" &&
    current.status !== "known_error" &&
    hasWorkaround(next)
  );
}
