-- "Other (please describe)" on the category picker.
--
-- Two things, and neither touches an existing ticket:
--   1. a nullable column for what the person typed
--   2. one "Other" category row per customer, so the option exists to be picked
--
-- Additive only. Every ticket filed before today keeps its category and gets a
-- NULL description, which is the correct reading of it — nobody was asked.

-- 1. The description itself.
--
-- Nullable, and no CHECK constraint. The rule is "a ticket whose category has
-- code OTHER must have this", and a CHECK on `tickets` can only see
-- `category_id` — an integer whose meaning differs per tenant, because every
-- customer owns its own copy of every category. Expressing it here would mean
-- hard-coding a set of ids that changes whenever a customer is created. The rule
-- lives in shared/category-other.ts, at the single place tickets are written.
ALTER TABLE "tickets" ADD COLUMN "category_other" TEXT;

-- 2. The category row, one per customer that does not already have one.
--
-- Per customer because that is how categories work since they stopped being
-- shared: Acme's "Other" and Globex's "Other" are two rows carrying the same
-- code, which is what keeps a report grouping them into one line.
--
-- `code = 'OTHER'` is the identity. The NAME is a display decision a tenant may
-- translate or reword, so nothing may key on it.
--
-- NOT EXISTS rather than ON CONFLICT: `categories` is unique on
-- (customer_id, name) as well as (customer_id, code), so a customer that already
-- has a category called "Other" under some other code would collide on the name
-- and take the whole migration down with it. Skipping such a customer leaves
-- them without the option, which is visible and fixable; failing to deploy is
-- neither.
INSERT INTO "categories" ("name", "code", "customer_id", "created_at", "updated_at")
SELECT 'Other', 'OTHER', c."id", NOW(), NOW()
FROM "customers" c
WHERE NOT EXISTS (
  SELECT 1 FROM "categories" cat
  WHERE cat."customer_id" = c."id"
    AND (cat."code" = 'OTHER' OR cat."name" = 'Other')
);

-- Deliberately NOT done here:
--
--   * No backfill of `category_other`. A ticket filed under a real category has
--     nothing to describe, and one filed before this option existed was never
--     asked — inventing text for either would be making up a person's words.
--   * No re-filing of old tickets into "Other". Whatever category they were put
--     under is what the desk worked them as, and rewriting that would change
--     what every past report says.
