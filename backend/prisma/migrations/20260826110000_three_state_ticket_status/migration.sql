-- Narrow tickets.status to three values and derive "In Progress" from the
-- assignee instead of storing it.
--
-- The history table keeps the wider vocabulary: ticket_status_history is
-- append-only and the SLA source of truth, so its rows are left saying what
-- they said. The type it points at is renamed rather than rebuilt, which moves
-- every existing row to the new name for free and costs no rewrite.

ALTER TYPE "TicketStatus" RENAME TO "TicketStatusRecord";

CREATE TYPE "TicketStatus" AS ENUM ('new', 'pending', 'closed');

-- open        -> new      acknowledged; whether anyone is on it is the assignee's job to say
-- in_progress -> new      + the assignee already on the row, so it still reads as In Progress
-- resolved    -> pending  done, waiting on the requester (what pending now means)
ALTER TABLE "tickets"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "TicketStatus" USING (
    CASE "status"::text
      WHEN 'open' THEN 'new'
      WHEN 'in_progress' THEN 'new'
      WHEN 'resolved' THEN 'pending'
      ELSE "status"::text
    END::"TicketStatus"
  ),
  ALTER COLUMN "status" SET DEFAULT 'new';

-- The resolution clock now stops when a ticket reaches `pending` — that is where
-- the work finishes and the wait for confirmation starts. Rows that were
-- `resolved` already carry resolved_at; rows that were `pending` under the old
-- meaning (waiting on the requester, clock still running) do not, and their
-- stamp is taken from the history row that put them there so the SLA verdict and
-- the 72h auto-close have something to read.
UPDATE "tickets" t
SET "resolved_at" = COALESCE(
      (SELECT MAX(h."created_at")
         FROM "ticket_status_history" h
        WHERE h."ticket_id" = t."id" AND h."to_status" = 'pending'),
      t."updated_at"
    )
WHERE t."status" = 'pending' AND t."resolved_at" IS NULL;
