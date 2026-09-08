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

Two **partial unique indexes** exist only in migration SQL, because Prisma has no
syntax for them:

| index | rule |
|---|---|
| `projects_customer_id_name_live_key` | project names unique per customer **among live rows** — archiving one frees its name |
| `categories_shared_name_key` | shared category names (`customer_id IS NULL`) unique — `@@unique([customerId, name])` cannot do it, since Postgres treats NULLs as distinct |

`prisma migrate diff` leaves indexes it does not recognise alone, so they survive
a normal migration. **Foreign keys are different** — a raw one IS reported as
drift and proposed for dropping, which is why the composite
`(project_id, customer_id) → projects(id, customer_id)` is declared in the schema
instead (`@relation(fields: [projectId, customerId], references: [id, customerId])`).

`test/constraints.integration.test.ts` asserts each rule still bites, so losing
one turns a test red rather than silently removing a guarantee. If you regenerate
a migration and Prisma proposes dropping either index, put it back.

**The test database is built with `migrate deploy`, not `db push`** (see
`test/global-setup.ts`), for exactly this reason: `db push` applies
schema.prisma alone, so a pushed database lacks both indexes and the suite would
accept writes production refuses.

## First run

`cp .env.example .env` · `docker compose up -d postgres` (the compose file is at the **repo root**,
not in `backend/`) · **`npx prisma generate`** — must be run explicitly, this npm env blocks
postinstall scripts · `npm run db:migrate` · `npm run db:seed`.
