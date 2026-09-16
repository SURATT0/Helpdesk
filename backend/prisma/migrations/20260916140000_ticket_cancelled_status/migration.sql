-- A requester can withdraw a ticket the desk has not moved yet.
--
-- One new value on each of the two status enums, and nothing else. Additive:
-- no row changes, and every existing ticket keeps the status it has.

-- `cancelled` is a status of its own rather than a flavour of `closed`, which is
-- the whole point of it. Closed is work the desk finished; cancelled is work
-- that never happened. Folding the two together would put withdrawals into the
-- closed archive, into handling-time figures and into every "how much did we get
-- through" count, inflating all three with tickets nobody worked.
ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'cancelled';

-- And on the history vocabulary, because `ticket_status_history` records the
-- move into it like any other. That enum is deliberately wider than what can be
-- stored today (it still holds `open`, `in_progress`, `resolved` from before the
-- three-value model), so this is one more word it has to accept, not a change to
-- anything already written.
ALTER TYPE "TicketStatusRecord" ADD VALUE IF NOT EXISTS 'cancelled';

-- Deliberately NOT done here:
--
--   * No backfill, and nothing to backfill: cancelling did not exist, so no
--     closed ticket can be known to have been a withdrawal. Guessing from, say,
--     "closed with no desk reply" would relabel tickets the desk genuinely
--     handled over the phone.
--   * No `cancelled_at` column. `ticket_status_history` already records when the
--     move happened and who made it, and `closed_at` stays NULL on a cancelled
--     ticket on purpose — it is what dates the closed archive and the 30-day
--     reopen window, and a withdrawal belongs in neither.
