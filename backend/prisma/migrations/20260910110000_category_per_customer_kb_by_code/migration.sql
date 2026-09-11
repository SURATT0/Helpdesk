-- Every category belongs to exactly one customer, and the knowledge base stops
-- pointing at category rows.
--
-- Written by hand rather than generated. `prisma migrate dev` proposes dropping
-- `kb_articles.category_id` and setting `categories.customer_id` NOT NULL with no
-- idea what to do about the rows those affect — which is every article and every
-- ticket. The order below is the whole point: copy, repoint, verify, and only
-- then tighten.
--
-- Nothing is deleted. The six shared categories are not removed; the
-- lowest-numbered customer ADOPTS them, so that customer's tickets never move at
-- all and only the other tenants' rows are repointed. Choosing the keeper that
-- way is not arbitrary — it is the tenant most likely to hold the bulk of the
-- history, and moving the fewest rows is the safest version of this migration.

-- ---------------------------------------------------------------------------
-- 1. The knowledge base stops belonging to anybody.
--
-- An article pointed at a category row. Once those rows have owners, every
-- article would have been inherited by whichever customer adopted the row it
-- named — so the shared library would have quietly become one tenant's, which is
-- the opposite of what it is for ("one article on resetting a password serves
-- every tenant", and why KbArticle has no customer_id and never did).
--
-- It carries the SUBJECT instead. Each tenant's own category carries the same
-- code, so an article still lines up with a reader's categories without being
-- owned by any of them.
-- ---------------------------------------------------------------------------
ALTER TABLE "kb_articles" ADD COLUMN "category_code" TEXT;

UPDATE "kb_articles" ka
   SET "category_code" = c."code"
  FROM "categories" c
 WHERE c."id" = ka."category_id";

-- No article can be left without one: `category_id` was NOT NULL with a foreign
-- key behind it, so every row above found its category.
ALTER TABLE "kb_articles" ALTER COLUMN "category_code" SET NOT NULL;

ALTER TABLE "kb_articles" DROP CONSTRAINT "kb_articles_category_id_fkey";
DROP INDEX "kb_articles_category_id_idx";
ALTER TABLE "kb_articles" DROP COLUMN "category_id";
CREATE INDEX "kb_articles_category_code_idx" ON "kb_articles"("category_code");

-- ---------------------------------------------------------------------------
-- 2. One copy of each shared category per customer that is not the keeper.
--
-- `default_team_id` is NOT copied across blindly. A team belongs to a customer,
-- so carrying the shared row's team onto another tenant's copy would route that
-- tenant's tickets into a team belonging to somebody else — which is what the
-- shared rows were already quietly doing, and is a routing leak rather than a
-- feature. A copy takes a default team only when the customer has one of its own
-- under the same NAME; otherwise it takes none, and an administrator picks one.
--
-- Skipped where the customer already has a category with that code or that name,
-- so this is safe on a database where somebody has already made their own.
-- ---------------------------------------------------------------------------
INSERT INTO "categories" ("name", "code", "customer_id", "default_team_id", "created_at", "updated_at")
SELECT shared."name",
       shared."code",
       cu."id",
       (SELECT t."id"
          FROM "teams" t
         WHERE t."customer_id" = cu."id"
           AND t."name" = (SELECT t2."name" FROM "teams" t2 WHERE t2."id" = shared."default_team_id")),
       now(),
       now()
  FROM "categories" shared
 CROSS JOIN "customers" cu
 WHERE shared."customer_id" IS NULL
   -- Archived customers included, deliberately: their tickets still point at
   -- these rows, and the foreign key added at the end does not care that the
   -- tenant is closed.
   AND cu."id" <> (SELECT min("id") FROM "customers")
   AND NOT EXISTS (
     SELECT 1 FROM "categories" own
      WHERE own."customer_id" = cu."id"
        AND (own."code" = shared."code" OR own."name" = shared."name")
   );

-- ---------------------------------------------------------------------------
-- 3. Move every ticket that is NOT the keeper's onto its own tenant's row.
--
-- Matched on `code`, not on name: a customer who already had their own
-- "Networking" with code NETWORK should receive these tickets, and the name is
-- the part they are free to change.
-- ---------------------------------------------------------------------------
UPDATE "tickets" t
   SET "category_id" = own."id"
  FROM "categories" shared, "categories" own
 WHERE t."category_id" = shared."id"
   AND shared."customer_id" IS NULL
   AND own."customer_id" = t."customer_id"
   AND own."code" = shared."code";

-- 4. The keeper adopts what is left, so its own tickets never moved.
UPDATE "categories"
   SET "customer_id" = (SELECT min("id") FROM "customers")
 WHERE "customer_id" IS NULL;

ALTER TABLE "categories" ALTER COLUMN "customer_id" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Prove the repointing was complete BEFORE the constraint is asked to.
--
-- The foreign key at the end would catch a mismatch anyway, but it would report
-- it as an opaque constraint violation naming neither the ticket nor the reason.
-- A database with a customer this migration could not find a category for — one
-- whose tickets were somehow filed under a tenant with no matching code — should
-- say so in the words of the problem, and roll the whole thing back.
-- ---------------------------------------------------------------------------
DO $$
DECLARE stranded INTEGER;
BEGIN
  SELECT count(*) INTO stranded
    FROM "tickets" t
    JOIN "categories" c ON c."id" = t."category_id"
   WHERE c."customer_id" <> t."customer_id";

  IF stranded > 0 THEN
    RAISE EXCEPTION
      'category_per_customer: % ticket(s) point at another customer''s category. '
      'Every customer needs a category carrying the same code as the one its '
      'tickets use; create the missing rows and re-run.', stranded;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Uniqueness, restated now that there are no NULL owners left.
-- ---------------------------------------------------------------------------

-- The partial index that kept the SHARED names distinct. Postgres treats NULLs
-- as distinct, so it existed to stop two shared categories both being called
-- "Hardware". There are no shared rows any more and there cannot be another, so
-- it now covers nothing — `categories_customer_id_name_key` is the whole rule.
DROP INDEX "categories_shared_name_key";

-- One row per code per tenant. Without this a customer could hold two rows with
-- the same code and be double-counted in every report that groups by it — which
-- is the one job the code exists to do.
CREATE UNIQUE INDEX "categories_customer_id_code_key" ON "categories"("customer_id", "code");

-- The key the composite foreign key below references. Redundant on its own —
-- `id` is already the primary key — and that is exactly its job, the same way
-- `projects_id_customer_id_key` is.
CREATE UNIQUE INDEX "categories_id_customer_id_key" ON "categories"("id", "customer_id");

-- ---------------------------------------------------------------------------
-- 7. A ticket may only point at a category belonging to its OWN customer.
--
-- The twin of the (project_id, customer_id) key added with projects, and the
-- second half of what makes "a ticket's project and its category name the same
-- tenant" a fact the database holds rather than a rule the service remembers.
-- Together they mean a ticket carrying customer A's project and customer B's
-- category cannot be written at all, from any code path, ever.
--
-- Unlike the project one this is never skipped: `category_id` is NOT NULL, so
-- MATCH SIMPLE always checks it.
--
-- The old single-column foreign key goes, replaced by this one — leaving both
-- would mean two constraints saying overlapping things about the same column.
-- ---------------------------------------------------------------------------
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_category_id_fkey";
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_category_id_customer_id_fkey"
  FOREIGN KEY ("category_id", "customer_id") REFERENCES "categories"("id", "customer_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
