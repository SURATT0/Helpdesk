import { PrismaClient } from "@prisma/client";
import path from "node:path";
import {
  buildDisplayName,
} from "../src/modules/attachments/attachment.naming";

/**
 * Give every attachment that predates `display_name` one.
 *
 * Data, not schema, so it lives here rather than in the migration: the naming
 * rules — Thai preserved, 40-character slug, 100-character cap, sequence
 * widening past 99 — are a TypeScript function, and writing them a second time
 * in SQL would be two implementations of one rule that could drift apart. This
 * imports the same function the upload path uses.
 *
 * Safe to run more than once. It only fills rows where the column is null, so a
 * second pass over an already-migrated table reports zero and changes nothing.
 *
 *   npm run db:backfill:display-names
 *   npm run db:backfill:display-names -- --dry-run
 */

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

/**
 * The extension to name the file with.
 *
 * Taken from the stored `content_type`, not from the uploader's filename: the
 * type is what the server will serve the bytes as, and it is the only one of the
 * two this codebase has verified. Falls back to the filename's own suffix for a
 * type this map does not know, and to nothing at all rather than guessing.
 */
const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

function extFor(contentType: string, filename: string): string {
  const known = EXT_BY_TYPE[contentType];
  if (known) return known;
  const suffix = path.extname(filename).replace(/^\./, "").toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(suffix) ? suffix : "";
}

async function main() {
  const pending = await prisma.attachment.findMany({
    where: { displayName: null },
    select: {
      id: true,
      ticketId: true,
      filename: true,
      contentType: true,
      createdAt: true,
    },
    // Ordered by ticket, then by age: the sequence a file gets has to match the
    // order it was uploaded in, or the numbers say nothing. `id` breaks ties,
    // because a CSV import can write several rows in the same millisecond.
    orderBy: [{ ticketId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  if (pending.length === 0) {
    console.log("backfill: nothing to do — every attachment already has a name");
    return;
  }

  /**
   * Where each ticket's numbering starts.
   *
   * Not simply 1: a ticket can already hold named rows (uploaded since the
   * column landed), and restarting at 1 would collide with them. Counting what
   * is already named per ticket is what makes this safe to run against a live
   * table, and the unique index on (ticket_id, display_name) is what would catch
   * it if this reasoning were wrong.
   */
  const alreadyNamed = new Map<number, number>();
  for (const ticketId of new Set(pending.map((a) => a.ticketId))) {
    alreadyNamed.set(
      ticketId,
      await prisma.attachment.count({
        where: { ticketId, displayName: { not: null } },
      }),
    );
  }

  const seq = new Map<number, number>();
  let updated = 0;
  const perTicket = new Map<number, number>();

  for (const row of pending) {
    const start = alreadyNamed.get(row.ticketId) ?? 0;
    const next = (seq.get(row.ticketId) ?? start) + 1;
    seq.set(row.ticketId, next);

    const displayName = buildDisplayName({
      ticketId: row.ticketId,
      sequence: next,
      originalName: row.filename,
      ext: extFor(row.contentType, row.filename),
    });

    if (!DRY_RUN) {
      await prisma.attachment.update({
        where: { id: row.id },
        data: { displayName },
      });
    }
    updated += 1;
    perTicket.set(row.ticketId, (perTicket.get(row.ticketId) ?? 0) + 1);
  }

  console.log(
    `backfill${DRY_RUN ? " (dry run)" : ""}: named ${updated} attachment${
      updated === 1 ? "" : "s"
    } across ${perTicket.size} ticket${perTicket.size === 1 ? "" : "s"}`,
  );

  // `ticket_id` is NOT NULL in the schema, so there is no such row to find — but
  // the check is cheap and says so out loud rather than leaving the reader to
  // trust that it was considered.
  const orphans = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM attachments WHERE ticket_id IS NULL
  `;
  const orphanCount = Number(orphans[0]?.count ?? 0);
  console.log(
    orphanCount === 0
      ? "backfill: no attachment without a ticket (ticket_id is NOT NULL)"
      : `backfill: ${orphanCount} attachment(s) have no ticket — NOT named, reported for a human to decide`,
  );

  // Nothing should be left unnamed unless a row arrived mid-run.
  const remaining = await prisma.attachment.count({ where: { displayName: null } });
  if (!DRY_RUN && remaining > 0) {
    console.warn(
      `backfill: ${remaining} row(s) still unnamed — re-run to pick up rows written during this pass`,
    );
  }
}

main()
  .catch((err) => {
    console.error("backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
