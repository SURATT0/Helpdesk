-- Backfill tickets.customer_id from the requester's customer.
--
-- 20260724091902_add_customer_tenant added tickets.customer_id (and the same
-- column on users and teams) as a plain nullable ALTER with no UPDATE, so every
-- row that already existed kept NULL. Rows created since are fine: ticket
-- creation stamps the requester's customer ("A ticket belongs to its requester's
-- customer" — ticket.repository.ts), and email intake has required a customerId
-- on the create path since 20260803 (PR #10). This migration is only about the
-- rows that predate those two guards.
--
-- Why it matters: ticketScopeWhere matches tenant-bound staff with
-- `{ customerId: user.customerId }`, an equality test. NULL never equals
-- anything, so a tenant-less ticket is invisible to EVERY customer-bound
-- admin and super_admin — only a platform-wide super_admin (super_admin with
-- customer_id IS NULL, per isPlatformWide) can see it. Such tickets are not
-- over-exposed; they are stranded, sitting unworked because nobody whose queue
-- they belong in can see them.
--
-- The requester's customer is the correct source: it is exactly what the current
-- create path uses, so this reproduces the value the row would have been given
-- had the column existed at the time.
--
-- No-op on a database seeded after 20260724091902 — there are no NULL rows to fix.

UPDATE "tickets" t
SET "customer_id" = u."customer_id"
FROM "users" u
WHERE u."id" = t."requester_id"
  AND t."customer_id" IS NULL
  AND u."customer_id" IS NOT NULL;

-- Deliberately NOT fixed here: tickets whose requester ALSO has no customer.
-- Those come from email intake before PR #10 closed the unknown-sender hole, and
-- nothing in the database says which tenant they belong to — the sending address
-- is external, and inventing a tenant would silently hand one customer another's
-- correspondence. They need a human decision (set the user's customer, or drop
-- the account), so this migration leaves them visible-to-platform-only rather
-- than guessing. Find them with:
--
--   SELECT t.id, u.email FROM tickets t JOIN users u ON u.id = t.requester_id
--   WHERE t.customer_id IS NULL;
