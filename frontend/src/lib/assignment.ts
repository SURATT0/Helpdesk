import type { User } from "@/features/users/schemas";

/**
 * May this person hold work belonging to `customerId`?
 *
 * The offer-side half of `mayReceiveAssignment` in the API's
 * `modules/tickets/ticket.scope.ts` — the two questions that are about the
 * CANDIDATE rather than about the caller:
 *
 *   a requester never holds work — they raise it, and their own row scope
 *   cannot see a queue;
 *
 *   everybody else must be able to SEE that customer's tickets, which means
 *   their own customer or platform-wide staff, who see every tenant's.
 *
 * **Not a gate.** The API checks all of it again, and additionally asks whether
 * the CALLER may hand work to this person at all — which a picker cannot know
 * about itself. This exists so a screen does not offer a choice that comes back
 * 400: a name in a dropdown reads as a promise.
 *
 * Granted reach is deliberately not consulted, matching the server: reach lets
 * somebody see a tenant's work, it never makes them a member of it, so a
 * granted agent stays out of that customer's queue the same way they stay out
 * of its directory.
 */
export function canHoldWorkFor(user: User, customerId: number): boolean {
  if (user.role === "user") return false;
  // Platform staff — the top role with no tenant of their own. Mirrors
  // `isPlatformWide` on the server; a super_admin who BELONGS to a customer is
  // confined to it like anybody else.
  if (user.customer == null) return user.role === "super_admin";
  return user.customer.id === customerId;
}
