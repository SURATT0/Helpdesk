# CLAUDE.md — `backend/`

Guidance for the Deskly API. Loads only when working with files under `backend/`.
Project-wide rules (domain invariants, RBAC scoping, design source of truth) live in the root
`CLAUDE.md`.

## Module conventions

- **Vertical-slice modules** under `src/modules/` — each owns its routes, controller, service,
  repository, and zod validators. Cross-cutting concerns live in `middlewares/` and `shared/`,
  never inside a module.
- **Repository pattern:** services never touch SQL, and the repository layer is the *only* place
  that touches the database. Swapping driver/ORM touches one layer.

## Database objects Prisma does not know about

One **partial unique index** exists only in migration SQL, because Prisma has no
syntax for it:

| index | rule |
|---|---|
| `projects_customer_id_name_live_key` | project names unique per customer **among live rows** — archiving one frees its name |

There used to be a second, `categories_shared_name_key`, covering the SHARED
categories (`customer_id IS NULL`). It is gone with the state it described:
`categories.customer_id` is now required, so there are no NULLs left for Postgres
to treat as distinct and `@@unique([customerId, name])` answers the whole
question on its own.

`prisma migrate diff` leaves indexes it does not recognise alone, so it survives
a normal migration. **Foreign keys are different** — a raw one IS reported as
drift and proposed for dropping, which is why both composite keys are declared in
the schema instead: `(project_id, customer_id) → projects(id, customer_id)` and
`(category_id, customer_id) → categories(id, customer_id)`, each written as
`@relation(fields: [xId, customerId], references: [id, customerId])`. Together
they are what makes "a ticket's project and its category name the same tenant" a
fact the database holds rather than a rule the service remembers.

`test/constraints.integration.test.ts` asserts each rule still bites, so losing
one turns a test red rather than silently removing a guarantee. If you regenerate
a migration and Prisma proposes dropping the index, put it back.

**The test database is built with `migrate deploy`, not `db push`** (see
`test/global-setup.ts`), for exactly this reason: `db push` applies
schema.prisma alone, so a pushed database lacks the index and the suite would
accept writes production refuses.

## First run

`cp .env.example .env` · `docker compose up -d postgres` (the compose file is at the **repo root**,
not in `backend/`) · **`npx prisma generate`** — must be run explicitly, this npm env blocks
postinstall scripts · `npm run db:migrate` · `npm run db:seed`.
