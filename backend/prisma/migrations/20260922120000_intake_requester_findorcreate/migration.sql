-- Retires the shared public-intake system account, bootstrapped by
-- 20260921100000_public_intake_schema.
--
-- Superseded: intake.repository.ts now calls the same
-- emailRepository.findOrCreateRequester(email, name, customerId) that email
-- intake already used for an unknown sender — reuse an existing Deskly
-- account by email when one exists (so a matched submitter who already has a
-- login sees their own ticket under ticketScopeWhere's ordinary
-- `{requesterId: user.id}` rule), else create a real, passwordless
-- correspondent row under the resolved tenant. One shared account no longer
-- has a reason to exist: every intake ticket now has its own genuine
-- requester, exactly like every other ticket in the system.
--
-- The system TENANT this account belonged to is untouched — customerId
-- still needs a real value for an unmatched submission, and that placeholder
-- is still where those land (see 20260921100000's own migration and
-- seedSystemIntakeTenant in prisma/seed-fn.ts, which no longer creates this
-- user but still provisions the tenant + its starter categories).
--
-- Deleted by its fixed bootstrap email, not by the flag about to be dropped
-- below, so this reads correctly however it is ordered against the DROP
-- COLUMN. `users.id` is RESTRICT from `tickets.requester_id` (see that
-- column's own comment), so this fails loudly — rolling back the whole
-- migration — rather than silently orphaning data, if any ticket was ever
-- filed against this account before this migration ran.
DELETE FROM "users" WHERE "email" = 'public-intake@system.deskly.internal';

-- AlterTable
ALTER TABLE "users" DROP COLUMN "is_system_account";
