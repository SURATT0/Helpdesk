-- Sort Thai the way a Thai reader reads it.
--
-- Thai has leading vowels — เ แ โ ใ ไ — written before their consonant and
-- sorted after it. In Unicode they sit at U+0E40–U+0E44, above every Thai
-- consonant (ก U+0E01 … ฮ U+0E2E), so a byte sort strands every word beginning
-- with one at the end of the list: "เกม" lands after "ฮาร์ดดิสก์" instead of
-- beside "กบ" and "ไก่".
--
-- That is what this database was doing. It reports `en_US.utf8`, which sounds
-- locale-aware and is not: the image is Alpine, Alpine is musl, and musl
-- implements no collation tables — `strcoll` falls back to byte comparison. The
-- locale name is decoration; the behaviour is `C`.
--
-- Set on the COLUMN rather than per query, and that is a constraint rather than
-- a preference: Prisma models no collation at all — not in schema.prisma, not in
-- `orderBy`. Query-level collation would mean rewriting six repository methods
-- as raw SQL and losing the scoping they compose. On the column, every
-- `ORDER BY name` Prisma emits is already right, including the ones nobody has
-- written yet.
--
-- ICU is compiled into this build (908 collations, `th-TH-x-icu` among them), so
-- nothing has to be installed for this to work.

-- The four columns that are actually ORDER BY-ed. See docs/thai-collation.md for
-- why tickets.subject, teams.name and the rest are deliberately left alone.
ALTER TABLE "categories" ALTER COLUMN "name" TYPE text COLLATE "th-TH-x-icu";
ALTER TABLE "customers"  ALTER COLUMN "name" TYPE text COLLATE "th-TH-x-icu";
ALTER TABLE "projects"   ALTER COLUMN "name" TYPE text COLLATE "th-TH-x-icu";
ALTER TABLE "users"      ALTER COLUMN "name" TYPE text COLLATE "th-TH-x-icu";

-- Index impact, measured in a rolled-back transaction against real data before
-- this was written:
--
--   * Zero indexes left invalid. Postgres rebuilds every index over a collated
--     column as part of the ALTER; there is no REINDEX step to remember.
--   * `projects_customer_id_name_live_key` survives intact and still partial
--     (WHERE deleted_at IS NULL). That index lives in raw migration SQL because
--     Prisma cannot express it — see backend/CLAUDE.md — so it was the one worth
--     checking by hand.
--   * Zero new unique collisions on categories(customer_id,name),
--     customers(name), or projects(customer_id,name) WHERE deleted_at IS NULL.
--     `th-TH-x-icu` is tertiary strength by default, so "Network" and "network"
--     stay distinct values that merely sort next to each other.
--
-- Deliberately NOT done:
--
--   * The DATABASE collation is untouched. Changing it needs a dump/restore of
--     the cluster and touches every index in it; nothing here needs that.
--   * No index on `(name COLLATE "th-TH-x-icu")`. An ORDER BY under this
--     collation no longer uses the plain btree for ordering, so these sorts
--     happen in memory — at 175 categories, 24 customers, 40 projects and a
--     handful of users that is not measurable. Add one the day `users` is big
--     enough to notice; it needs no change to the column.
