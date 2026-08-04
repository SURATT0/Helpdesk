-- Collapse the four roles into three: user < admin < super_admin.
--
-- Hand-written rather than generated, because the generated version drops the
-- removed enum values and would fail against any existing row. The mapping is the
-- point of this migration and belongs in it explicitly:
--
--   requester -> user         end users: raise a ticket, follow it, read the KB
--   agent     -> admin        the people who actually work cases
--   manager   -> super_admin  merged; see the caveat below
--   admin     -> super_admin
--
-- manager and admin differed in REACH, not in rank: admin carried
-- users.customer_id = NULL and so saw every tenant, while a manager was pinned to
-- one. Merging them into a single role means the role name can no longer carry
-- that distinction, so reach moves onto customer_id, which already held it:
-- super_admin with customer_id = NULL is platform-wide, super_admin with a
-- customer_id manages that customer only. Former managers keep their customer_id
-- and therefore keep their old reach.
--
-- Postgres cannot drop a value from an enum in use, so this swaps the type.

CREATE TYPE "Role_new" AS ENUM ('super_admin', 'admin', 'user');

ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "Role_new"
  USING (
    CASE "role"::text
      WHEN 'admin'     THEN 'super_admin'
      WHEN 'manager'   THEN 'super_admin'
      WHEN 'agent'     THEN 'admin'
      WHEN 'requester' THEN 'user'
    END
  )::"Role_new";

DROP TYPE "Role";

ALTER TYPE "Role_new" RENAME TO "Role";
