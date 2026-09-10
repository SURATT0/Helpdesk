import { apiRequest } from "@/lib/api-client";
import {
  userEnvelopeSchema,
  userListSchema,
  type User,
  type UserFilters,
  type UserRole,
  type UserStatus,
} from "./schemas";

export async function fetchUsers(filters: UserFilters = {}): Promise<User[]> {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.role) params.set("role", filters.role);
  if (filters.status) params.set("status", filters.status);
  if (filters.customerId != null) {
    params.set("customerId", String(filters.customerId));
  }
  const qs = params.toString();
  const body = await apiRequest(`/users${qs ? `?${qs}` : ""}`);
  return userListSchema.parse(body).data;
}

/**
 * Approve a registration: choose the customer it belongs to and the role it
 * gets, in one act.
 *
 * Both are required by the server, and that is the point rather than an
 * oversight — approving decides which company somebody is part of and what they
 * may do, so neither may be defaulted into by a form that forgot to ask.
 *
 * Platform-wide staff only. A customer's own super admin cannot see the queue
 * in the first place: an applicant belongs to no tenant yet, so the directory's
 * scope filter excludes them.
 */
export async function approveUser(
  id: number,
  input: { customerId: number; role: UserRole },
): Promise<User> {
  const body = await apiRequest(`/users/${id}/approve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return userEnvelopeSchema.parse(body).data;
}

/**
 * Turn a registration down. The reason is for the audit trail only — the
 * applicant is deliberately not mailed, because a rejection is news somebody may
 * want to deliver in their own words.
 */
export async function rejectUser(
  id: number,
  reason?: string,
): Promise<User> {
  const body = await apiRequest(`/users/${id}/reject`, {
    method: "POST",
    body: JSON.stringify(reason?.trim() ? { reason: reason.trim() } : {}),
  });
  return userEnvelopeSchema.parse(body).data;
}

export type UpdateMyProfileInput = {
  name?: string;
  /**
   * Mark yourself away. Project routing then skips you in favour of the backup
   * owner; it does not restrict anything you can see or do.
   */
  availableForAssignment?: boolean;
  /**
   * The language to write to you in. Stored on the account rather than only in
   * this browser because the server composes your email hours later, with no
   * browser to ask.
   */
  language?: "en" | "th";
};

/**
 * Self-service: update the signed-in user's own profile. Deliberately cannot
 * touch role, team, or project — those are management decisions.
 */
export async function updateMyProfile(
  input: UpdateMyProfileInput,
): Promise<User> {
  const body = await apiRequest("/users/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return userEnvelopeSchema.parse(body).data;
}

export type UpdateUserInput = {
  role?: UserRole;
  teamId?: number | null;
  /** Routing group; `null` detaches the user from any project. */
  projectId?: number | null;
  availableForAssignment?: boolean;
  /**
   * Close or reopen the account. The server refuses to close your own, or one
   * that still holds unfinished tickets — hand the queue over first.
   */
  isActive?: boolean;
  /**
   * Suspend the account, or lift a suspension. ONLY those two values — the
   * server refuses `pending` and `rejected` here, because those belong to the
   * approval queue and an active account must not be pushable back into a queue
   * it has already been through.
   */
  status?: Extract<UserStatus, "active" | "suspended">;
};

/**
 * Management edit of another user, requiring `user:write` and scoped server-side
 * to the actor's own customer. Only an admin may grant the admin role.
 */
export async function updateUser(
  id: number,
  input: UpdateUserInput,
): Promise<User> {
  const body = await apiRequest(`/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return userEnvelopeSchema.parse(body).data;
}

/**
 * Replace the whole set of customers a member of staff may work beyond their
 * own. An empty array revokes everything.
 *
 * A replace rather than add/remove, matching the server: reach is a statement
 * about a person, not a log of adjustments, so sending the intended set makes
 * a retry harmless and leaves one audit row saying what it became.
 *
 * Platform-wide staff only — a customer's own super admin gets a 403, and so
 * does anyone pointing this at themselves.
 */
export async function setUserReach(
  id: number,
  customerIds: number[],
): Promise<User> {
  const body = await apiRequest(`/users/${id}/reach`, {
    method: "PUT",
    body: JSON.stringify({ customerIds }),
  });
  return userEnvelopeSchema.parse(body).data;
}
