# 20260826110000_three_state_ticket_status

Narrows `tickets.status` to `new | pending | closed` and derives "In Progress"
from the assignee. `ticket_status_history` keeps the older vocabulary under
`TicketStatusRecord` — it is append-only and the SLA source of truth.

## Mapping

| before        | after     | why |
|---------------|-----------|-----|
| `open`        | `new`     | acknowledged but unfinished; whether anyone is on it is the assignee's job to say |
| `in_progress` | `new`     | the assignee already on the row is what makes it read as In Progress |
| `resolved`    | `pending` | done, waiting on the requester — which is what `pending` now means |

`resolved_at` is backfilled for tickets that were `pending` under the old
meaning, from the history row that put them there (falling back to
`updated_at`), because the SLA verdict and the 72h auto-close both read it.

## Rows converted on the development database (2026-08-26)

Counted immediately before the migration ran:

```
open        → new        4 rows
in_progress → new        4 rows
resolved    → pending    3 rows
                        11 rows changed value; 40 history rows untouched
```

Ten of those eleven are named in the snapshot taken shortly beforehand
(`deskly-db-backups/tickets_status_snapshot_20260826.csv`):

```
in_progress → new       #1027, #1042, #2017, #2016 (unassigned)
open        → new       #1029, #1035, #2002 (unassigned), #2014 (unassigned)
resolved    → pending   #1031, #2110
```

The eleventh was a `resolved` ticket an end-to-end run created between that
snapshot and the migration, and deleted in the same session's cleanup. It cannot
be named from here, and guessing at an id would be worse than saying so.

The four that had an assignee (#1027, #1042, #1029, #1035) read as **In
Progress** afterwards without any further change — that is the point of deriving
it. #2016, #2002 and #2014 read as **New**: they claimed work nobody was doing,
which the three-value model makes unrepresentable.

## Reversing it

`down.sql` in this folder, run by hand — Prisma has no `migrate down`. It
restores each ticket's status from its last `ticket_status_history` row, which is
why that table was left alone. Read the header of that file first: `resolved_at`
is deliberately not unset, and a ticket with no history row cannot be restored.

One more limit worth knowing: **re-seeding rewrites history for seeded tickets**
(`seed-fn.ts` deletes and recreates their trail), so on a database that has been
re-seeded since, those rows now say `new`/`pending`/`closed` and the reversal
restores them to the three-value words rather than the six-value ones. Tickets
raised through the app keep their real trail either way.

## A note for anyone editing `migration.sql`

Do not. It is applied in every environment that has run it, and Prisma stores a
checksum: editing the file makes `migrate status` and `migrate deploy` fail with
a mismatch on those databases. Corrections go in a new migration.
