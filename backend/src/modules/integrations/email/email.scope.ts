import type { Role } from "@prisma/client";
import { customerReach, isPlatformWide } from "../../../shared/auth";

/** The ticket a mailed reply claims, reduced to what the decision needs. */
export type ReplyTargetFacts = {
  requesterId: number;
  assigneeId: number | null;
  customerId: number | null;
  affectedUserIds: number[];
};

/** The sender of that mail, resolved to a user. */
export type ReplySenderFacts = {
  id: number;
  role: Role;
  /** Home tenant. */
  customerId: number | null;
  /** Customers granted beyond it — see UserCustomer. */
  customerIds?: number[];
};

/**
 * May this sender append a mailed reply to this ticket?
 *
 * Pure so it can be unit-tested, mirroring `ticketScopeWhere` / `assetScopeWhere`.
 * The `[#123]` tag that located the ticket is attacker-controllable — anyone can
 * type it into a subject line — so finding the ticket is NOT authorization. This
 * is the gate.
 *
 *   participant   → requester, assignee, or a listed affected user;
 *   platform-wide → any ticket, any customer;
 *   other staff   → only inside a customer they reach.
 *
 * Cross-tenant reach goes through `isPlatformWide`, which requires the top role
 * AND no tenant of its own, so this agrees with `ticketScopeWhere`: staff who
 * happen to have no customer are granted nothing there, and must not be granted
 * every tenant's threads here.
 *
 * A sender who fails this check is not an error — the caller opens a new ticket
 * instead, so no mail is dropped and no stranger reaches an existing thread.
 */
export function senderMayReply(
  ticket: ReplyTargetFacts,
  sender: ReplySenderFacts,
): boolean {
  if (
    ticket.requesterId === sender.id ||
    ticket.assigneeId === sender.id ||
    ticket.affectedUserIds.includes(sender.id)
  ) {
    return true;
  }
  if (isPlatformWide(sender)) return true;
  if (sender.role === "user") return false;
  return (
    ticket.customerId != null &&
    customerReach(sender).includes(ticket.customerId)
  );
}
