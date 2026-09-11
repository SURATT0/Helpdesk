-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('pending', 'active', 'suspended', 'rejected');

-- CreateEnum
CREATE TYPE "UserTokenPurpose" AS ENUM ('password_reset', 'email_verification');

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "code" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified_at" TIMESTAMP(3),
ADD COLUMN     "status" "UserStatus";

-- CreateTable
CREATE TABLE "user_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "purpose" "UserTokenPurpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_tokens_token_hash_key" ON "user_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "user_tokens_user_id_purpose_idx" ON "user_tokens"("user_id", "purpose");

-- AddForeignKey
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill, then tighten. Everything above this line is additive; everything
-- below gives the two new NOT NULL columns their value for rows that predate
-- them and only then makes them required.
--
-- Add → backfill → SET NOT NULL inside ONE migration, deliberately. The reason
-- to split those across deploys is a rolling release where the previous build is
-- still inserting rows without the column; neither of these columns has such a
-- writer, because no code has ever named them. What the split would buy here is
-- a window in which `users.status` is nullable — and a null status is precisely
-- the value the sign-in gate cannot interpret, so that window is the dangerous
-- state rather than the safe one.
-- ---------------------------------------------------------------------------

-- Every account that already exists is one an administrator or the seed created
-- on purpose, so `active` is not a guess — it is what all of them already were.
-- `pending` starts existing only once self-registration does, which is the next
-- commit.
UPDATE "users" SET "status" = 'active' WHERE "status" IS NULL;
ALTER TABLE "users" ALTER COLUMN "status" SET NOT NULL;

-- Deliberately no DEFAULT. A default of 'active' would mean that a create path
-- which forgets to name a status silently mints a fully privileged account —
-- exactly the mistake self-registration must not make. Without one, the compiler
-- asks every caller the question.

-- Stamped with `created_at`, not `now()`: these addresses were accepted when the
-- account was made, by a person who already knew whose they were. Writing today's
-- date would claim a verification that did not happen today, and demanding they
-- re-verify would lock out the entire existing desk to enforce a rule none of
-- them broke.
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;
-- Stays NULLABLE on purpose — null is a real, permanent state meaning "never
-- proven", which is where every self-registered account starts.

-- The code behind the name. Derived from the current name for existing rows,
-- which is exactly right for the six the desk started with: they ARE the
-- canonical set, so their names are the canonical codes.
--
-- Character-for-character the same derivation as `categoryCode()` in
-- src/modules/categories/category.code.ts, including the trimmed underscores —
-- a row written by this backfill and a row written by the app must carry the
-- same code for the same name, or a report groups them as two things.
UPDATE "categories"
   SET "code" = upper(btrim(regexp_replace(btrim("name"), '[^a-zA-Z0-9]+', '_', 'g'), '_'))
 WHERE "code" IS NULL;
ALTER TABLE "categories" ALTER COLUMN "code" SET NOT NULL;

-- No uniqueness on `code` yet, on purpose. Its final shape is unique per
-- customer, and `customer_id` is still nullable at this point — a unique index
-- over (customer_id, code) would treat today's six shared rows as six distinct
-- NULL owners and then have to be rebuilt anyway. It lands with the migration
-- that makes `customer_id` required, where it can be stated once and correctly.
