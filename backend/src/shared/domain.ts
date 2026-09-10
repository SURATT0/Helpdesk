/**
 * Domain vocabulary shared across modules. Kept in sync with the frontend's
 * `src/lib/domain.ts` and the architecture spec.
 */
/**
 * Ticket status lives in `./ticket-status` — the stored vocabulary, the
 * displayed one, the derivation between them and the transition whitelist, all
 * in one file. Re-exported here ONLY as types so existing imports of the domain
 * vocabulary keep working; import the helpers from ticket-status directly.
 */
export type {
  DisplayStatus,
  TicketStatus,
  TicketStatusRecord,
} from "./ticket-status";

export type Priority = "low" | "medium" | "high" | "critical";

/**
 * RBAC roles, ordered super_admin > admin > user.
 *
 *   user        raises a ticket, follows it, reads the knowledge base
 *   admin       works cases: replies, reassigns, changes status and priority
 *   super_admin manages the admins, and everything an admin can do
 *
 * The role says WHAT a principal may do. WHICH customers they reach is a separate
 * axis carried by `AuthUser.customerId` — null is platform-wide, a value pins them
 * to that one tenant. Keeping the two apart is what lets a single super_admin role
 * serve both a platform owner and one customer's manager without either gaining
 * the other's reach.
 */
export type Role = "super_admin" | "admin" | "user";

/** Highest first. Index = rank, so a lower index outranks a higher one. */
export const ROLE_ORDER: readonly Role[] = ["super_admin", "admin", "user"];

/**
 * Where an account is in its life — a third axis, separate from both the role
 * (what it may do) and the reach (which tenants it sees).
 *
 * Only `active` may hold a session. The other three are all "no", kept apart
 * because they are answers to different questions and the person is told a
 * different thing by each: `pending` has applied and nobody has decided yet,
 * `rejected` was decided against, `suspended` was let in and then stopped.
 */
export type UserStatus = "pending" | "active" | "suspended" | "rejected";

/**
 * May an account in this state hold a session?
 *
 * The single source of truth, deliberately one function rather than
 * `status === "active"` written at each gate. There are four of those — sign-in,
 * token refresh, `GET /me` and the bearer-token middleware — and a fifth will be
 * added by whoever adds the next entry point. One of five copies drifting is a
 * way in.
 */
export function maySignIn(status: UserStatus): boolean {
  return status === "active";
}

/** Does `role` sit at or above `minimum` in the hierarchy? */
export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_ORDER.indexOf(role) <= ROLE_ORDER.indexOf(minimum);
}

/**
 * Does this ticket's conversation have an external side at all?
 *
 * A ticket raised by a `user` has two sides: the requester, who reads the public
 * thread and gets the emails, and the desk, which also has internal notes the
 * requester never sees. A ticket raised by staff has only one — they opened it,
 * they work it, they close it. There is nobody on the other end to chat with or
 * mail, so every message on such a ticket is an internal note and the two-sided
 * composer is asking the reader to pick an audience that does not exist.
 *
 * Keyed on the REQUESTER's role, never the viewer's: if it were the viewer's, a
 * second admin picking up the case would see a chat box while the requesting
 * admin saw notes only, and one of them would be writing into a tab the other
 * cannot answer from. The property belongs to the ticket, so both sides agree.
 */
export function isInternalThread(requesterRole: Role): boolean {
  return requesterRole !== "user";
}
