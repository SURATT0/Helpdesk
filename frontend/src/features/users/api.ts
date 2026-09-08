import { apiRequest } from "@/lib/api-client";
import {
  userEnvelopeSchema,
  userListSchema,
  type User,
  type UserRole,
} from "./schemas";

export async function fetchUsers(): Promise<User[]> {
  const body = await apiRequest("/users");
  return userListSchema.parse(body).data;
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
