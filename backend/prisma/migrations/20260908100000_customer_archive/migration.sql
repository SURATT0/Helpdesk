-- Customers are archived, never deleted.
--
-- A tenant's id is on every ticket, audit row, project and asset it ever had.
-- Hard-deleting one would either take those with it or strand them, and the
-- existing foreign keys already refuse it: `projects` and `tickets` are
-- RESTRICT, and `users`, `teams`, `assets` and `problems` are SET NULL, which
-- would silently detach them from any tenant at all.
--
-- Two nullable columns, mirroring the soft delete `projects` already has.
-- Nothing is backfilled: every existing customer is live, which is what a null
-- `deleted_at` already means.
ALTER TABLE "customers" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "customers" ADD COLUMN "deleted_by_id" INTEGER;

-- SET NULL, unlike the tenant columns above, and deliberately: this records WHO
-- archived the customer, so if that person's account is ever removed the
-- archival still stands — losing the name of the actor is a smaller loss than
-- refusing to remove an account, and the audit_logs row keeps the full story.
ALTER TABLE "customers" ADD CONSTRAINT "customers_deleted_by_id_fkey"
  FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
