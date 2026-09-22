# Adding, renaming, or retiring a service

This is for anyone who needs to change the list of services people can pick
from on the public intake form (bluefish.co.th's "แจ้งเรื่อง" form) — you do
not need to know how to code to follow it. It also controls the same list
inside Deskly, so you only ever edit one file and both places update
together.

## The one file: `backend/config/services.json`

Every service is a small block that looks like this:

```json
{
  "code": "blue-digital",
  "label": "Blue Digital",
  "desc": "Scan and convert documents into digital files",
  "active": true
}
```

- **`code`** — a permanent internal ID. Never shown to a customer. See
  "Things you must never do" below — this is the one field with a hard rule.
- **`label`** — the name shown on the form and in Deskly. Safe to edit any
  time, e.g. to fix a typo or rename a service for marketing reasons.
- **`desc`** — the one-line description shown next to the name on the form.
  Also safe to edit any time.
- **`active`** — `true` to offer it on the form, `false` to retire it (see
  below). This is the only field you change to stop offering a service.

Services are grouped under a `group` name with an `order` number that
controls which group appears first, second, and so on on the form. Each
group looks like this:

```json
{
  "group": "3D — Document Management",
  "order": 1,
  "services": [ ... the blocks above go here ... ]
}
```

## Adding a new service

1. Open `backend/config/services.json`.
2. Decide which existing group it belongs to (or add a new group block if it
   genuinely needs one — copy the shape above, with an `order` number that
   isn't already used).
3. Add a new block inside that group's `"services"` list, following the
   shape above. Make up a short, permanent `code` for it (lowercase, hyphens,
   no spaces — e.g. `blue-scan-2`). Double-check it isn't already used by
   another service anywhere in the file.
4. Set `"active": true`.
5. Save the file, then follow "After you save," below.

## Renaming a service, or fixing its description

Edit `label` and/or `desc` in place. That's it — nothing else needs to
change, and nothing about old tickets is affected (see "Why `code` is
special," below).

## Retiring a service (taking it off the form)

Find its block and change `"active": true` to `"active": false`. Do **not**
delete the block — see the next section for why.

## Things you must never do

- **Never rename a `code`, and never delete a service's block, even a
  retired one.** Every ticket ever submitted through the form remembers
  which service it was about *by its `code`*, not by its name. If you
  rename or remove a code, Deskly can no longer tell you which service an
  old ticket was for — it just shows a blank. Renaming the `label` is
  completely safe and encouraged; renaming the `code` is not.
- **Never reuse a retired `code` for a different, unrelated service.** If
  "blue-digital" is retired and you later want to offer something new,
  give it a fresh code — don't revive an old one for a different purpose.
- **Never edit `service_catalog` directly in the database.** The file is
  the source of truth; the database is just what the seed step (below)
  copies it into. A direct database edit is undone the next time anyone
  runs the seed.

## After you save: apply the change

Editing the file alone does not change anything by itself — two more steps:

1. **Run the seed script**, from the `backend/` folder:

   ```
   npm run db:seed:services
   ```

   This reads `config/services.json` and updates Deskly's own copy of the
   list. It's safe to run as many times as you like — it never creates
   duplicates, and it never deletes anything (a service missing from the
   file is automatically retired, exactly like setting `active: false`
   yourself).

2. **Deploy** the updated `config/services.json` to the server that serves
   the public intake form. The form reads this file directly every time
   someone opens it, so as soon as the new file is live, the form shows the
   change — no separate form deployment is needed.

If you skip step 1, Deskly's ticket list, filters, and reports will not
know about your change even though the public form does (or vice versa) —
always do both.

## If something goes wrong

The seed script checks the file before touching the database, and refuses
to run — with a plain-English error naming the problem — if:

- the file isn't valid JSON (a missing comma, a stray bracket, etc.),
- a required field is missing or empty (e.g. a service with no `label`),
- the same `code` appears twice, or
- every service was accidentally removed (this is refused even if the file
  is technically valid, since it would otherwise retire everything at
  once).

Nothing is changed in the database if the script refuses — fix the file and
run it again.
