-- Per-customer notification policy: which events are mailed, how often, and
-- when the SLA starts warning.
--
-- No backfill on purpose. A customer with no row is UNCONFIGURED, not
-- misconfigured, and every reader falls back to the deployment defaults
-- (env.ticketEmail, SLA_WARN_MS). Seeding a row holding today's defaults would
-- freeze them: the next time a default changed, every customer would silently
-- keep the old value with nobody having chosen it.
--
-- Reversible: DROP TABLE "notification_settings".

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "disabled_events" TEXT[],
    "rate_per_ticket" INTEGER NOT NULL,
    "rate_window_ms" INTEGER NOT NULL,
    "sla_warn_ms" INTEGER NOT NULL,
    "updated_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One row per customer. The uniqueness is what lets the write be an upsert and
-- the read a single lookup, with no "which of these two is current?" to answer.
CREATE UNIQUE INDEX "notification_settings_customer_id_key" ON "notification_settings"("customer_id");

-- AddForeignKey
-- CASCADE: a tenant's policy has no meaning without the tenant. Unlike tickets,
-- there is no history here worth keeping past the customer it described.
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
