/**
 * May this person still correct the wording of their own ticket?
 *
 * Mirrors the server's guard in `ticketRepository.updateOwnWording`, the same
 * arrangement `lib/domain.ts` and `lib/ticket-status.ts` use. **The server is
 * the authority** — it takes this decision again inside the transaction that
 * writes, because an agent can reply between a person opening the editor and
 * pressing Save. What this is for is deciding whether to OFFER the edit, so the
 * ordinary case does not have to be refused to be understood.
 *
 * Two conditions, and the second is not "unassigned". A ticket can sit assigned
 * to an agent who has not read it yet — "In Progress" on the board is `new` plus
 * an assignee and nothing more — and correcting a typo then is exactly when it
 * helps. What closes the door is an ANSWER: a public reply from the desk, or the
 * ticket having moved out of `new` at all.
 *
 * A public reply, not an internal note, which is the same line SLA's
 * first-response clock draws. Two definitions of "the desk answered" would
 * eventually disagree, and this is the cheaper one to keep aligned.
 */
export function mayEditOwnWording(input: {
  status: string;
  requesterId: number;
  viewerId: number | undefined;
  comments: { internal: boolean; author: { role: string } }[];
}): boolean {
  if (input.viewerId == null || input.requesterId !== input.viewerId) return false;
  if (input.status !== "new") return false;
  return !input.comments.some(
    (c) => !c.internal && c.author.role !== "user",
  );
}
