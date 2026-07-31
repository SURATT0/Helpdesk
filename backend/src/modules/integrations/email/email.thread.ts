import type { Role } from "../../../shared/domain";

/** A sender resolved to a known user, reduced to what the rule below needs. */
export type ThreadSender = {
  id: number;
  role: Role;
  customerId: number | null;
};

/** The target ticket, reduced to what the rule below needs. */
export type ThreadTarget = {
  requesterId: number;
  assigneeId: number | null;
  customerId: number | null;
  /** Ids from ticket_affected_users — people the ticket is *about*. */
  affectedUserIds: number[];
};

/**
 * May an inbound email from `sender` be appended to `ticket`?
 *
 * This is the authorization gate on email threading, and it exists because the
 * routing hint is attacker-controlled: anyone who can send mail to the helpdesk
 * inbox can type `[#42]` into a subject line. Without this check, a stranger
 * could inject messages into any ticket's thread and impersonate the requester
 * to the agent working it. A failed check is NOT an error — `ingest` falls back
 * to opening a new ticket, so a legitimate sender who merely quoted a ticket
 * number still gets help.
 *
 * Mirrors `ticketScopeWhere`'s visibility model deliberately: the rule for "may
 * write to this thread" must never be broader than "may read this ticket".
 *   requester        → only tickets they raised, or that name them as affected
 *   agent / manager  → any ticket inside their own customer
 *   admin            → any ticket, any customer
 *
 * Pure so it can be unit tested, like `mayReceiveAssignment` in ticket.scope.ts.
 */
export function maySenderPostOnTicket(
  sender: ThreadSender,
  ticket: ThreadTarget,
): boolean {
  // Participants can always continue their own conversation, whatever the role.
  if (sender.id === ticket.requesterId) return true;
  if (ticket.assigneeId != null && sender.id === ticket.assigneeId) return true;
  if (ticket.affectedUserIds.includes(sender.id)) return true;

  if (sender.role === "admin") return true;
  if (sender.role === "requester") return false;
  // agent + manager: their whole customer, matching ticketScopeWhere. A staff
  // user with no customer gets nothing beyond the participant checks above.
  if (sender.customerId == null) return false;
  return sender.customerId === ticket.customerId;
}
