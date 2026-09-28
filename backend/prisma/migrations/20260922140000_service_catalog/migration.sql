-- The public-intake form's service dropdown, moved from a hard-coded
-- <select> in public/intake/index.html to a database table seeded from
-- config/services.json (see prisma/seed-services.ts and
-- docs/adding-a-service.md).
--
-- Entirely additive: a new table, and one new NULLABLE column on tickets.
-- No existing row changes.

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "service_code" TEXT;

-- CreateTable
CREATE TABLE "service_catalog" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "desc" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_catalog_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "service_catalog_active_group_order_idx" ON "service_catalog"("active", "group", "order");

-- CreateIndex
CREATE INDEX "tickets_service_code_idx" ON "tickets"("service_code");
