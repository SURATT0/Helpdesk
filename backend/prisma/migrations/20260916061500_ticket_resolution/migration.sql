-- What the desk did about a ticket, required when it declares the work finished.
--
-- One nullable column, and nothing else. Additive: every ticket already on disk
-- keeps every value it has and gets a NULL here.

-- Nullable, and no CHECK constraint — for a reason that differs from the one
-- `category_other` had. That rule was unexpressible because it spanned another
-- table; this one is unexpressible because it is not a rule about the ROW at
-- all. "A finished ticket has a resolution" is false as stated: a ticket reaches
-- `closed` from `pending` when the requester confirms it or when the 72h sweep
-- gives up, and neither of them did the work or can describe it. What must carry
-- a resolution is the MOVE — `new -> pending` and `new -> closed`, the two ways
-- the desk says it is done. A CHECK sees the row after the fact and cannot tell
-- which transition produced it, so it would either reject the requester's
-- confirmation or permit a silent close; both are wrong. The rule lives in
-- `requiresResolution` in shared/ticket-status.ts and is enforced inside the
-- transaction that writes the status.
ALTER TABLE "tickets" ADD COLUMN "resolution" TEXT;

-- Deliberately NOT done here:
--
--   * No backfill. Tickets closed before today were closed without anyone being
--     asked what they did, and the honest record of that is NULL. Copying the
--     last comment in would read as the agent's account of the fix when it is
--     just the last thing said on the thread — often "thanks, all good" from the
--     requester.
--   * No NOT NULL, now or later. The column stays nullable permanently: the
--     tickets above can never be filled in, and a reopened ticket that has not
--     been finished again is correctly empty until it is.
