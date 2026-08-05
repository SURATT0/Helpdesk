-- Soft delete for tickets: super-admin only, and deliberately NOT a hard delete.
--
-- The normal end of a ticket's life is `closed`, which keeps it in the history log
-- ("tickets are closed, never deleted"). This adds an escape hatch for a row that
-- should never have existed — spam through the email intake, a mis-filed import —
-- without giving up what the closed log and the SLA reports are built on.
--
-- Nothing is removed from disk. Every FK pointing at tickets (comments,
-- attachments, ticket_status_history, ticket_reads) is ON DELETE RESTRICT, i.e.
-- the schema was built on the assumption that a ticket row never goes away, and
-- ticket_status_history in particular is the SLA source of truth. A hard delete
-- would have to cascade through all of it and take the history with it, so the row
-- stays and `ticketScopeWhere` filters it out of every read instead — the same
-- pattern comments already use.

ALTER TABLE "tickets" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- Every ticket read now carries `deleted_at IS NULL` alongside the tenant filter,
-- so the existing customer_id index is extended rather than joined by a second one.
CREATE INDEX "tickets_customer_id_deleted_at_idx" ON "tickets"("customer_id", "deleted_at");
