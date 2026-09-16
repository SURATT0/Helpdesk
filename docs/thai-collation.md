# Sorting Thai text

Deskly is used in Thai. Sorting it correctly is not something a database does by
accident, and the default configuration got it wrong in a way that is invisible
until real Thai data arrives.

## What was wrong

A Thai word can begin with a **leading vowel** — เ แ โ ใ ไ — which is *written*
before its consonant but *pronounced and sorted* after it. In Unicode those five
characters sit at U+0E40–U+0E44, above every Thai consonant (ก U+0E01 … ฮ U+0E2E).
So any sort that compares code points or bytes dumps every leading-vowel word at
the end of the list, far from the consonant it belongs with.

The database was doing exactly that. Postgres 16 reported its collation as
`en_US.utf8`, which sounds locale-aware and is not: the image is Alpine, Alpine
is musl, and **musl does not implement collation tables** — its `strcoll` falls
back to byte comparison, so `en_US.utf8` on this image behaves as `C`.

Measured, with the test set:

```
before (en_US.utf8 on musl — byte order)
  Network · network · กบ · ขนม · งาน · จอ · ฟอง · ระบบ · อีเมล · ฮาร์ดดิสก์ ·
  เกม · เน็ต · แขก · โปรแกรม · ใจ · ไก่ · ไฟ
         ^^^^^^^^ every leading-vowel word, stranded at the end

after (th-TH-x-icu)
  กบ · เกม · ไก่ · ขนม · แขก · งาน · จอ · ใจ · เน็ต · โปรแกรม · ฟอง · ไฟ ·
  ระบบ · อีเมล · ฮาร์ดดิสก์ · network · Network
```

`เกม` moves from position 11 to position 2, beside `กบ` and `ไก่` where a Thai
reader looks for it.

## The decisions

**Thai first, Latin last.** Mixed lists group by script, Thai before English.
This is what `th-TH` collation does natively on both sides — Postgres ICU and
`Intl.Collator` — so it is the ordering that needs no arguing with either.

**Sorted in the database.** Six of the nine sort sites already ordered in
Postgres; only the ticket table's column sort ran in JS. Sorting in the database
also keeps paging honest: a JS sort can only order the page it has been given.

**Collation on the COLUMN, not on the query.** This is a constraint rather than
a preference — Prisma has no API for `COLLATE` in `orderBy`, and no way to
express it in the schema. Reaching query-level collation would mean rewriting six
repository methods as raw SQL, losing the scoping and relation composition they
are built from. Setting it on the column instead means every `ORDER BY name`
Prisma emits is already correct, including ones nobody has written yet.

## Index impact, measured before applying

Changing a column's collation rewrites the table and rebuilds every index over
that column. Dry-run in a rolled-back transaction against real data:

| check | result |
|---|---|
| indexes left invalid | **0** — Postgres rebuilds them inside the `ALTER` |
| `projects_customer_id_name_live_key` (partial unique, raw SQL — see backend/CLAUDE.md) | **survives intact, still partial** |
| new unique collisions on `categories(customer_id,name)` | **0** |
| new unique collisions on `customers(name)` | **0** |
| new unique collisions on `projects(customer_id,name) WHERE deleted_at IS NULL` | **0** |

No collisions because `th-TH-x-icu` is tertiary-strength by default: `Network`
and `network` remain distinct values, they merely sort adjacently.

**Not done:** the database-level collation is untouched. Changing it would
require a dump/restore of the whole cluster and would affect every index in it;
nothing here needs that.

## Which columns

Collated: `categories.name`, `customers.name`, `projects.name`, `users.name` —
the four that are actually `ORDER BY`-ed.

Deliberately not collated:

- `tickets.subject` — sorted only in the browser, by the column header on the
  ticket table, over rows already fetched. The client collator is `th-TH` too, so
  the two agree; collating the column would rewrite the largest table in the
  schema for an ordering nothing asks the database for.
- `teams.name`, `assets.name`, `problems.title` — displayed but never sorted.
  Worth doing the day one of them gets a sorted list, not before.
- `categories.code`, `kb_articles.category_code` — ASCII by construction
  (`categoryCode()` strips everything else), so collation cannot change them.

## The client half

`frontend/src/lib/collation.ts` holds one `Intl.Collator('th-TH')` instance,
built once at module scope. Building one inside a comparator costs a collator
construction per comparison, which on a few hundred rows is the difference
between instant and visibly slow.

`sensitivity: 'base'` folds case, so `Network` and `network` compare equal and
stay adjacent. `numeric: true` makes `Project 2` come before `Project 10`.

One honest wrinkle: the database collation is tertiary (case-sensitive) while the
client is `base` (case-folding). Both keep `Network` and `network` adjacent;
they can disagree about which of the two comes first. No list is sorted by both,
so nothing flips — but that is why, not luck.

## "Other" is not sorted

`อื่นๆ` / `Other` is the answer for a ticket none of the categories fit, so it
belongs at the bottom of every picker regardless of how its name sorts.
`otherLast()` in `lib/category-other.ts` does that, keyed on the category CODE
(`OTHER`) rather than the name — a tenant may rename or translate their copy.
