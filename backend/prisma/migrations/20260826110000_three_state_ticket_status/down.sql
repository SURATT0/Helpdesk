-- Reversal for 20260826110000_three_state_ticket_status.
--
-- Prisma has no `migrate down`, so this is run by hand:
--   psql "$DATABASE_URL" -f down.sql
-- and then the row is removed from _prisma_migrations so the forward migration
-- can be applied again:
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260826110000_three_state_ticket_status';
--
-- What it restores, and what it cannot:
--
-- The forward migration mapped open → new, in_progress → new, resolved →
-- pending. Those three words survive in `ticket_status_history`, which is
-- append-only and was deliberately left alone, so each ticket's last recorded
-- status is the value to put back. A ticket with no history row keeps whatever
-- it holds now — there is nothing to restore it from, and inventing one would be
-- worse than leaving it.
--
-- `resolved_at` is NOT unset. The forward migration backfilled it for tickets
-- that were `pending` under the old meaning, and there is no way to tell those
-- apart from ones that legitimately finished afterwards. It is a timestamp, not
-- a state, and leaving it costs nothing: the old model ignored it except on
-- resolved/closed rows.

BEGIN;

-- 1. The wide vocabulary becomes the ticket column's type again.
CREATE TYPE "TicketStatusOld" AS ENUM (
  'new', 'open', 'in_progress', 'pending', 'resolved', 'closed'
);

ALTER TABLE "tickets"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "TicketStatusOld" USING ("status"::text::"TicketStatusOld"),
  ALTER COLUMN "status" SET DEFAULT 'new';

-- 2. Put back what each ticket last was, according to the history.
WITH last_seen AS (
  SELECT DISTINCT ON (h."ticket_id")
         h."ticket_id" AS id,
         h."to_status"::text AS status
    FROM "ticket_status_history" h
   ORDER BY h."ticket_id", h."created_at" DESC, h."id" DESC
)
UPDATE "tickets" t
   SET "status" = l.status::"TicketStatusOld"
  FROM last_seen l
 WHERE l.id = t."id"
   AND l.status <> t."status"::text;

-- 3. Swap the type names back, so the schema reads as it did before.
DROP TYPE "TicketStatus";
ALTER TYPE "TicketStatusOld" RENAME TO "TicketStatus";
ALTER TYPE "TicketStatusRecord" RENAME TO "TicketStatusRecord_dropme";
ALTER TABLE "ticket_status_history"
  ALTER COLUMN "from_status" TYPE "TicketStatus" USING ("from_status"::text::"TicketStatus"),
  ALTER COLUMN "to_status" TYPE "TicketStatus" USING ("to_status"::text::"TicketStatus");
DROP TYPE "TicketStatusRecord_dropme";

COMMIT;
