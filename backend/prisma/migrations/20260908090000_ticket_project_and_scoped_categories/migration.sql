-- Ticket → Project, and categories that can belong to one customer.
--
-- Additive throughout: two nullable columns, no UPDATE, no DROP TABLE. The two
-- indexes dropped are replaced by stricter or equivalent ones in the same
-- migration, so nothing is left unconstrained.

-- `tickets.project_id` — which project a ticket belongs to.
--
-- Nullable and staying that way: mail and CSV name no project, a customer may
-- run none, and the tickets raised before this column existed have no project
-- anyone can honestly infer.
ALTER TABLE "tickets" ADD COLUMN "project_id" INTEGER;

-- `categories.customer_id` — null means SHARED with every customer.
--
-- RESTRICT, not Prisma's usual SET NULL for an optional relation: on SET NULL,
-- deleting a customer would turn their private categories into shared ones and
-- publish them to every other tenant. That is the one failure mode of a
-- nullable tenant column, and it is a leak, so it is refused instead.
ALTER TABLE "categories" ADD COLUMN "customer_id" INTEGER;
ALTER TABLE "categories" ADD CONSTRAINT "categories_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "categories_customer_id_idx" ON "categories"("customer_id");

-- Category names: unique per owner. `name` stops being globally unique — a
-- customer may call their own category "Hardware" while a shared one exists.
DROP INDEX "categories_name_key";
CREATE UNIQUE INDEX "categories_customer_id_name_key"
  ON "categories"("customer_id", "name");

-- Project names: the old constraint counted archived rows, so a deleted
-- "Migration" held its name forever. With 18 archived projects to 5 live, that
-- is a wall people hit while looking at a list that does not contain the
-- culprit. Replaced below by a partial index over live rows only.
DROP INDEX "projects_customer_id_name_key";

-- The key the composite foreign key below references. Redundant on its own —
-- `id` is already the primary key — and that is exactly its job.
CREATE UNIQUE INDEX "projects_id_customer_id_key"
  ON "projects"("id", "customer_id");

-- A ticket may only point at a project belonging to its OWN customer.
--
-- A rule the service could enforce and a database can prove. A composite
-- foreign key rather than a trigger or a CHECK: it costs nothing on read, and
-- no future write path can forget it. Postgres skips the check when
-- `project_id` is NULL (MATCH SIMPLE), which is what keeps the column optional.
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_project_id_customer_id_fkey"
  FOREIGN KEY ("project_id", "customer_id") REFERENCES "projects"("id", "customer_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- The two objects below are PARTIAL indexes, which Prisma cannot express, so
-- they are absent from schema.prisma. `prisma migrate diff` leaves indexes it
-- does not recognise alone (unlike foreign keys, which is why the one above is
-- declared in the schema instead) — but nothing guarantees that forever, so
-- `constraints.integration.test.ts` asserts each still bites. Losing one turns
-- a test red rather than silently removing a guarantee. See the note in
-- backend/CLAUDE.md.
-- ---------------------------------------------------------------------------

-- Live project names, per customer. Replaces the constraint dropped above; an
-- archived project no longer holds its name.
CREATE UNIQUE INDEX "projects_customer_id_name_live_key"
  ON "projects"("customer_id", "name") WHERE "deleted_at" IS NULL;

-- Shared category names. `categories_customer_id_name_key` does not cover
-- these: Postgres treats NULLs as distinct, so without this two shared
-- categories could both be called "Hardware".
CREATE UNIQUE INDEX "categories_shared_name_key"
  ON "categories"("name") WHERE "customer_id" IS NULL;
