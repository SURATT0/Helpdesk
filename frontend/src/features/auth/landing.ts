import type { Role } from "./schemas";

/**
 * Where a signed-in reader belongs when nothing else has been asked for.
 *
 * The dashboard is aggregate counts over a queue, and `dashboard:read` now gates
 * it — so sending a requester there after login would land them on a 403 as the
 * very first thing they saw. Their work is the tickets list: raising one and
 * following it is the whole of what the role does.
 *
 * A plain function rather than a redirect inside the dashboard page, because
 * three separate paths lead here — the root redirect, a fresh sign-in, and
 * arriving at /login with a live session — and a bounce placed at the
 * destination would show the wrong page first on every one of them.
 */
export function landingFor(role: Role | undefined): string {
  return role === "admin" || role === "super_admin" ? "/dashboard" : "/tickets";
}

/** Roles the dashboard and the reports page are for. Mirrors the API grants. */
export const REPORTING_ROLES: readonly Role[] = ["admin", "super_admin"];

export function canSeeReporting(role: Role | undefined): boolean {
  return role != null && REPORTING_ROLES.includes(role);
}
