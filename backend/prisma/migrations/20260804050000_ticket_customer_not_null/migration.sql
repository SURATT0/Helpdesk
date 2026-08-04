-- Make tickets.customer_id NOT NULL.
--
-- 20260804044000 backfilled the rows stranded by the original nullable ALTER, but
-- nothing stopped new ones appearing: ticket creation copies the requester's
-- customer, and users.customer_id is legitimately nullable (null = platform staff,
-- which is what isPlatformWide keys on). So a ticket raised by a platform-wide
-- super_admin was still written with customer_id = NULL — verified against the demo
-- stack, which answered 201 and produced a ticket no customer-bound admin can see.
--
-- The constraint is the fix that cannot be forgotten. The create path is guarded in
-- the same change (ticket.repository.ts rejects a requester with no customer with a
-- 400 rather than letting the insert fail), but the guard is a convention and this
-- is an invariant: any future write path gets it enforced for free.
--
-- Ordered defensively: backfill again, then refuse to proceed while any row would
-- violate the constraint, then apply it. The re-backfill makes this migration
-- independent of the previous one (it is idempotent and a no-op if that already
-- ran), and the explicit check turns a bare "column contains null values" into a
-- message that says which rows and what to do about them.

UPDATE "tickets" t
SET "customer_id" = u."customer_id"
FROM "users" u
WHERE u."id" = t."requester_id"
  AND t."customer_id" IS NULL
  AND u."customer_id" IS NOT NULL;

DO $$
DECLARE
  stranded integer;
  sample   text;
BEGIN
  SELECT count(*) INTO stranded FROM "tickets" WHERE "customer_id" IS NULL;

  IF stranded > 0 THEN
    SELECT string_agg(x.id::text, ', ') INTO sample
    FROM (SELECT id FROM "tickets" WHERE "customer_id" IS NULL ORDER BY id LIMIT 10) x;

    RAISE EXCEPTION
      '% ticket(s) still have no customer, so customer_id cannot be made NOT NULL (ids: %). '
      'These are tickets whose requester also has no customer — typically email intake from '
      'before the unknown-sender hole was closed. Decide the tenant for each (set the '
      'requester''s customer_id, or remove the row), then re-run this migration.',
      stranded, sample;
  END IF;
END $$;

ALTER TABLE "tickets" ALTER COLUMN "customer_id" SET NOT NULL;
