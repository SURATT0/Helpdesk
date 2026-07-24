-- CreateTable
CREATE TABLE "ticket_reads" (
    "ticket_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "last_read_comment_id" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_reads_pkey" PRIMARY KEY ("ticket_id","user_id")
);

-- AddForeignKey
ALTER TABLE "ticket_reads" ADD CONSTRAINT "ticket_reads_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_reads" ADD CONSTRAINT "ticket_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
