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

## First run

`cp .env.example .env` · `docker compose up -d postgres` (the compose file is at the **repo root**,
not in `backend/`) · **`npx prisma generate`** — must be run explicitly, this npm env blocks
postinstall scripts · `npm run db:migrate` · `npm run db:seed`.
