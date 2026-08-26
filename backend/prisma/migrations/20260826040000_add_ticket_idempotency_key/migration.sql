-- De-duplication key for the create-ticket request (the `Idempotency-Key`
-- header). Nullable: every ticket raised without one — CSV import, email
-- intake, an older client — keeps a NULL, and Postgres allows many NULLs under
-- a unique constraint, so those never collide with each other.
ALTER TABLE "tickets" ADD COLUMN "idempotency_key" TEXT;

-- What actually makes a repeated create idempotent. A check-then-insert cannot:
-- two requests in flight together both pass the check and both insert. Here the
-- second insert loses on this constraint instead, and the loser answers with the
-- row that won.
--
-- Scoped to the requester rather than globally unique, because the key is minted
-- client-side with no coordination: two people can pick the same string, and a
-- global constraint would hand one person's ticket back to the other.
CREATE UNIQUE INDEX "tickets_requester_id_idempotency_key_key" ON "tickets"("requester_id", "idempotency_key");
