import type { Prisma, PrismaClient } from "@prisma/client";
import { env } from "../../config/env";

type Tx = Prisma.TransactionClient | PrismaClient;

/** `YYYYMMDD` in the server's own timezone — the label the reference prints,
 * not an instant. See the `TicketNumberCounter.day` field comment. */
function today(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * Atomically issue the next `BF-YYYYMMDD-####` for today, inside the caller's
 * transaction.
 *
 * A single `INSERT ... ON CONFLICT (day) DO UPDATE ... RETURNING seq` — never
 * `count(*) + 1`, which is a race rather than a sequence: two requests reading
 * the same count at once would both claim the number after it. Raw SQL rather
 * than Prisma's `upsert`, so the atomicity is guaranteed by the single
 * statement Postgres executes rather than by how a future Prisma version
 * happens to compile an upsert.
 *
 * Call this INSIDE the transaction that also inserts the ticket (see
 * `intake.repository.ts`), and retry the whole transaction — not just this
 * call — if the ticket insert then hits a unique violation on `tickets.number`
 * (design doc §06: up to 3 attempts). That should not happen given this
 * function's own atomicity; the retry is the belt behind these braces, the
 * same shape the schema gives the counter table itself.
 */
export async function issueTicketNumber(tx: Tx): Promise<string> {
  const day = today();
  const rows = await tx.$queryRaw<{ seq: number }[]>`
    INSERT INTO "ticket_number_counters" ("day", "seq", "updated_at")
    VALUES (${day}, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("day")
    DO UPDATE SET "seq" = "ticket_number_counters"."seq" + 1, "updated_at" = CURRENT_TIMESTAMP
    RETURNING "seq"
  `;
  const seq = rows[0]?.seq;
  if (seq == null) {
    // Cannot happen — INSERT ... ON CONFLICT always returns exactly one row —
    // but a silent wrong ticket number is worse than a loud 500 here.
    throw new Error("ticket_number_counters: RETURNING produced no row");
  }
  return `${env.publicIntake.ticketPrefix}-${day}-${String(seq).padStart(4, "0")}`;
}
