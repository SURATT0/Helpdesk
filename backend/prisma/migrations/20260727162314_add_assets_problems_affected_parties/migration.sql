-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('laptop', 'desktop', 'phone', 'tablet', 'printer', 'server', 'network', 'software', 'other');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('active', 'in_repair', 'retired');

-- CreateEnum
CREATE TYPE "ProblemStatus" AS ENUM ('investigating', 'known_error', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "CommentChannel" AS ENUM ('web', 'email');

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "channel" "CommentChannel" NOT NULL DEFAULT 'web',
ADD COLUMN     "message_id" TEXT;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "problem_id" INTEGER;

-- CreateTable
CREATE TABLE "assets" (
    "id" SERIAL NOT NULL,
    "asset_tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL DEFAULT 'other',
    "status" "AssetStatus" NOT NULL DEFAULT 'active',
    "serial" TEXT,
    "location" TEXT,
    "owner_id" INTEGER,
    "customer_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_affected_users" (
    "ticket_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_affected_users_pkey" PRIMARY KEY ("ticket_id","user_id")
);

-- CreateTable
CREATE TABLE "ticket_affected_assets" (
    "ticket_id" INTEGER NOT NULL,
    "asset_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_affected_assets_pkey" PRIMARY KEY ("ticket_id","asset_id")
);

-- CreateTable
CREATE TABLE "problems" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProblemStatus" NOT NULL DEFAULT 'investigating',
    "root_cause" TEXT,
    "workaround" TEXT,
    "customer_id" INTEGER,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "problems_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assets_customer_id_idx" ON "assets"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "assets_customer_id_asset_tag_key" ON "assets"("customer_id", "asset_tag");

-- CreateIndex
CREATE INDEX "ticket_affected_users_user_id_idx" ON "ticket_affected_users"("user_id");

-- CreateIndex
CREATE INDEX "ticket_affected_assets_asset_id_idx" ON "ticket_affected_assets"("asset_id");

-- CreateIndex
CREATE INDEX "problems_customer_id_idx" ON "problems"("customer_id");

-- CreateIndex
CREATE INDEX "problems_status_idx" ON "problems"("status");

-- CreateIndex
CREATE UNIQUE INDEX "comments_message_id_key" ON "comments"("message_id");

-- CreateIndex
CREATE INDEX "tickets_problem_id_idx" ON "tickets"("problem_id");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_affected_users" ADD CONSTRAINT "ticket_affected_users_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_affected_users" ADD CONSTRAINT "ticket_affected_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_affected_assets" ADD CONSTRAINT "ticket_affected_assets_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_affected_assets" ADD CONSTRAINT "ticket_affected_assets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problems" ADD CONSTRAINT "problems_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problems" ADD CONSTRAINT "problems_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

