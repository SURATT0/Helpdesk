-- The message a ticket was raised with, as a real row rather than a column the
-- thread re-renders.
--
-- Deliberately NOT backfilled. Writing an opening comment for every existing
-- ticket would invent an author and a timestamp for conversations that already
-- happened, and the thread can tell the two apart without it: a ticket with no
-- opening comment falls back to rendering `tickets.description`, exactly as it
-- did before this column existed.
ALTER TABLE "comments"
  ADD COLUMN "is_opening" BOOLEAN NOT NULL DEFAULT false;
