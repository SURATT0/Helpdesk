-- CreateTable
CREATE TABLE "user_customers" (
    "user_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_customers_pkey" PRIMARY KEY ("user_id","customer_id")
);

-- CreateIndex
CREATE INDEX "user_customers_user_id_idx" ON "user_customers"("user_id");

-- CreateIndex
CREATE INDEX "user_customers_customer_id_idx" ON "user_customers"("customer_id");

-- AddForeignKey
ALTER TABLE "user_customers" ADD CONSTRAINT "user_customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_customers" ADD CONSTRAINT "user_customers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
