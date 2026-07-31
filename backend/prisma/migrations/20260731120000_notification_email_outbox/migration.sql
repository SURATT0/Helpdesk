-- Email-delivery marker, turning `notifications` into a transactional outbox.
-- Rows are written inside the mutation's transaction; a background sweep mails
-- the ones still NULL and stamps them.
ALTER TABLE "notifications" ADD COLUMN "emailed_at" TIMESTAMP(3);

-- Backfill every EXISTING row as already delivered. Without this, the first run
-- of the sweep after deploying would treat the entire notification history as
-- pending and mail all of it at once.
UPDATE "notifications" SET "emailed_at" = "created_at" WHERE "emailed_at" IS NULL;

-- The sweep's hot query is "where emailed_at is null, oldest first".
CREATE INDEX "notifications_emailed_at_idx" ON "notifications"("emailed_at");
