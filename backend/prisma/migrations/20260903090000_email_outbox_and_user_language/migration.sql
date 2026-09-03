-- Outbound ticket email: a queue of its own, and a language to write each
-- person in.
--
-- `email_outbox` replaces `notifications.emailed_at` as the delivery mechanism.
-- The notifications table keeps that column and keeps being the in-app bell —
-- what changes is that nothing reads `emailed_at` to decide what to send any
-- more. The last statement below stamps every row still pending so the retired
-- sweep, if it is ever run again from an older build, finds nothing to deliver
-- and cannot double-send what the new queue is now responsible for.
--
-- Additive and reversible: `DROP TABLE "email_outbox"`, drop the two enums, and
-- `ALTER TABLE "users" DROP COLUMN "language"`. The stamping of pending
-- notification rows is not reversible, but it only suppresses mail that the new
-- queue sends instead.

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('en', 'th');

-- CreateEnum
CREATE TYPE "EmailOutboxStatus" AS ENUM ('pending', 'sent', 'failed', 'suppressed');

-- AlterTable
-- Nullable and with NO default: null means "has never chosen", which is a
-- different fact from "chose Thai". Each reader supplies its own fallback and
-- they do not agree — mail falls back to Thai, the web app to English. A column
-- defaulting to 'th' would have silently flipped every existing account's UI to
-- Thai on their next sign-in, having asked none of them.
ALTER TABLE "users" ADD COLUMN     "language" "Language";

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "source_record_id" INTEGER NOT NULL,
    "recipient_user_id" INTEGER NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "lang" "Language" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "EmailOutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message_id" TEXT,
    "in_reply_to" TEXT,
    "references_header" TEXT,
    "suppressed_reason" TEXT,
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_outbox_message_id_key" ON "email_outbox"("message_id");

-- CreateIndex
-- The sweep's own query: pending rows whose backoff has elapsed.
CREATE INDEX "email_outbox_status_next_attempt_at_idx" ON "email_outbox"("status", "next_attempt_at");

-- CreateIndex
-- Finding the previous mail in a (ticket, recipient) conversation to thread onto.
CREATE INDEX "email_outbox_ticket_id_recipient_user_id_idx" ON "email_outbox"("ticket_id", "recipient_user_id");

-- CreateIndex
-- The idempotency key: one mail per (ticket, event, cause, recipient). A
-- constraint rather than a check-then-insert, because two requests in flight
-- together would both pass the check. Every column is NOT NULL so that two
-- identical events actually collide — Postgres treats NULLs as distinct, which
-- would let the duplicate through.
CREATE UNIQUE INDEX "email_outbox_ticket_id_event_type_source_record_id_recipien_key" ON "email_outbox"("ticket_id", "event_type", "source_record_id", "recipient_user_id");

-- AddForeignKey
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Retire the old delivery path's backlog. Rows left with emailed_at NULL were
-- queued for a sweep that no longer exists; the events they describe are now
-- carried by email_outbox, so delivering them too would send everything twice.
-- Stamping rather than deleting keeps the bell entries themselves intact.
UPDATE "notifications" SET "emailed_at" = NOW() WHERE "emailed_at" IS NULL;
