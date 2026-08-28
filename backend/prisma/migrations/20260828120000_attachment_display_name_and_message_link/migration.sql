-- Attachments gain a display name, a link to the message they were sent with,
-- and the pixel size + thumbnail key the chat needs to draw them.
--
-- Additive and reversible: every column is nullable and no existing value is
-- rewritten, so rolling back is `DROP COLUMN` on the five below (plus the index
-- and the foreign key). Nothing here backfills `display_name` — the naming rules
-- (Thai preserved, 40-char slug, 100-char cap, sequence widening) live in one
-- TypeScript function, and restating them in SQL would be a second
-- implementation of one rule. `prisma/backfill-display-names.ts` fills the
-- existing rows using that function and reports how many it touched.

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "comment_id" INTEGER,
ADD COLUMN     "display_name" TEXT,
ADD COLUMN     "thumb_key" TEXT,
ADD COLUMN     "width" INTEGER,
ADD COLUMN     "height" INTEGER;

-- CreateIndex
CREATE INDEX "attachments_comment_id_idx" ON "attachments"("comment_id");

-- CreateIndex
-- One display name per ticket, settled by the database. The sequence comes from
-- counting the ticket's existing files, and two concurrent uploads can read the
-- same count — the unique violation is what makes the loser retry with the next
-- number instead of writing a duplicate. Safe to add before the backfill: every
-- existing row has display_name NULL, and NULLs do not collide in Postgres.
CREATE UNIQUE INDEX "attachments_ticket_id_display_name_key" ON "attachments"("ticket_id", "display_name");

-- AddForeignKey
-- SET NULL rather than CASCADE: a file is a fact about the ticket, and losing the
-- message it arrived with must not delete the file with it.
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
