-- Public intake: schema for IntakeSubmission / ConsentLog / ticket numbering,
-- plus the tenant and account a public-form ticket needs when nobody signed in
-- to raise it.
--
-- Entirely additive. No existing column is dropped, narrowed or renamed, and
-- every new NOT NULL column on an existing table (`tickets.reported_at`) is
-- added nullable, backfilled, THEN constrained — never added NOT NULL against
-- rows that don't have a value yet.

-- ── Enums ───────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "TicketChannel" AS ENUM ('web', 'email', 'csv_import', 'web_intake');

-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('linked', 'triage', 'spam');

-- CreateEnum
CREATE TYPE "AttachmentScanStatus" AS ENUM ('pending', 'clean', 'infected', 'error');

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('disk', 's3');

-- ── attachments: new, all-nullable columns (no backfill needed — see the field
-- comments in schema.prisma: NULL means "predates this / never scanned", which
-- is a true statement for every existing row) ───────────────────────────────

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "scan_status" "AttachmentScanStatus",
ADD COLUMN     "scanned_at" TIMESTAMP(3),
ADD COLUMN     "storage_provider" "StorageProvider",
ADD COLUMN     "submission_id" INTEGER;

-- ── customers: domain match + the system-tenant flag ───────────────────────

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "is_system_tenant" BOOLEAN NOT NULL DEFAULT false;

-- ── users: the system-account flag ──────────────────────────────────────────

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_system_account" BOOLEAN NOT NULL DEFAULT false;

-- ── tickets: number/channel (nullable, deliberately never backfilled — see
-- schema.prisma) + reported_at, which IS backfilled, from each row's own
-- created_at rather than from a single NOW() the way a plain `NOT NULL DEFAULT
-- CURRENT_TIMESTAMP` column-add would: this column's whole point is that it can
-- differ from created_at for a ticket that arrived another way, and stamping
-- every pre-existing row with the migration's run time would make every one of
-- them lie in the one place a report might one day read it. ─────────────────

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "channel" "TicketChannel",
ADD COLUMN     "number" TEXT,
ADD COLUMN     "reported_at" TIMESTAMP(3);

UPDATE "tickets" SET "reported_at" = "created_at" WHERE "reported_at" IS NULL;

ALTER TABLE "tickets" ALTER COLUMN "reported_at" SET NOT NULL,
ALTER COLUMN "reported_at" SET DEFAULT CURRENT_TIMESTAMP;

-- ── New tables ───────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "intake_submissions" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER,
    "name" TEXT NOT NULL,
    "business_email" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "IntakeStatus" NOT NULL,
    "matched_customer_id" INTEGER,
    "is_free_mail" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "user_agent" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_logs" (
    "id" SERIAL NOT NULL,
    "submission_id" INTEGER NOT NULL,
    "consent_text" TEXT NOT NULL,
    "consent_version" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "ip" TEXT,
    "user_agent" TEXT,
    "granted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_number_counters" (
    "day" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_number_counters_pkey" PRIMARY KEY ("day")
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- CreateIndex
CREATE UNIQUE INDEX "intake_submissions_ticket_id_key" ON "intake_submissions"("ticket_id");

-- CreateIndex
CREATE INDEX "intake_submissions_business_email_idx" ON "intake_submissions"("business_email");

-- CreateIndex
CREATE INDEX "intake_submissions_status_created_at_idx" ON "intake_submissions"("status", "created_at");

-- CreateIndex
CREATE INDEX "consent_logs_submission_id_idx" ON "consent_logs"("submission_id");

-- CreateIndex
CREATE INDEX "attachments_submission_id_idx" ON "attachments"("submission_id");

-- CreateIndex
CREATE INDEX "attachments_scan_status_idx" ON "attachments"("scan_status");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_number_key" ON "tickets"("number");

-- CreateIndex
CREATE INDEX "tickets_channel_idx" ON "tickets"("channel");

-- ── Foreign keys ─────────────────────────────────────────────────────────────

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "intake_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_submissions" ADD CONSTRAINT "intake_submissions_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_logs" ADD CONSTRAINT "consent_logs_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "intake_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Data bootstrap: the system tenant + system account ──────────────────────
--
-- `tickets.customer_id`, `.category_id` and `.requester_id` are all required
-- (see backend/CLAUDE.md and the phase-1 compatibility review) and stay that
-- way — this migration does not relax any of them. An intake submission whose
-- email domain matches no customer still needs a real customer, a real
-- category belonging to it, and a real requester to point at, so this creates
-- exactly one of each: a customer flagged `is_system_tenant`, its own starter
-- category set (same names/codes every real tenant gets — see
-- STARTER_CATEGORY_NAMES — so a ticket parked here can still be filed and its
-- category later corrected without a null in either column), and a user
-- flagged `is_system_account` with no password hash and a non-active status,
-- so it can never sign in.
--
-- A submission whose domain DOES match a real customer still uses this SAME
-- system user as `requester_id` (there is one, global, never one per tenant) —
-- only `tickets.customer_id`/`category_id` point at the real tenant in that
-- case. `requester.customer_id` and `ticket.customer_id` can therefore differ
-- for a linked intake ticket; nothing in the schema ties them together (unlike
-- project/category, which are enforced by composite foreign keys), and this is
-- a deliberate, known consequence of choosing one shared system account over
-- provisioning one per tenant. Flagged for a closer look once the intake
-- service (phase 2, step 3) is writing real tickets through it.
--
-- Idempotent: guarded by the flag, not by a fixed id, so re-running this
-- migration (or applying it to a database that already has the row, e.g. from
-- a restored backup) does not create a second one.

INSERT INTO "customers" ("name", "is_system_tenant", "created_at", "updated_at")
SELECT 'Unmatched — Public Intake', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "customers" WHERE "is_system_tenant" = true);

INSERT INTO "categories" ("name", "code", "customer_id", "updated_at")
SELECT v."name", v."code", c."id", CURRENT_TIMESTAMP
FROM "customers" c
CROSS JOIN (VALUES
    ('Network', 'NETWORK'),
    ('Email', 'EMAIL'),
    ('Hardware', 'HARDWARE'),
    ('Access', 'ACCESS'),
    ('Accounts', 'ACCOUNTS'),
    ('Software', 'SOFTWARE'),
    ('Other', 'OTHER')
) AS v("name", "code")
WHERE c."is_system_tenant" = true
  AND NOT EXISTS (
    SELECT 1 FROM "categories" existing
    WHERE existing."customer_id" = c."id" AND existing."code" = v."code"
  );

INSERT INTO "users" ("name", "email", "role", "customer_id", "status", "is_active", "is_system_account", "password_hash", "created_at", "updated_at")
SELECT 'Public Intake', 'public-intake@system.deskly.internal', 'user', c."id", 'suspended', true, true, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "customers" c
WHERE c."is_system_tenant" = true
  AND NOT EXISTS (SELECT 1 FROM "users" WHERE "is_system_account" = true);
