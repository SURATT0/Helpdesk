# CLAUDE.md — `frontend/`

Guidance for the Deskly web app. Loads only when working with files under `frontend/`.
Project-wide rules (domain invariants, RBAC scoping, design source of truth) live in the root
`CLAUDE.md`.

## Structure

Structured by `features/` that mirror the backend modules one-for-one, each with `api.ts`,
`queries.ts`, `schemas.ts` (zod), `components/`. Keep new work in that shape.

`npm run build` also type-checks and lints.

## Design system tokens (from the WebApp doc)

Tokens live in `frontend/tailwind.config.ts` — read them there and use the token names rather than
raw hex. Match them exactly for visual fidelity; the status & priority palettes are semantic and
were **not** rebranded along with the brown/cream/green theme.

A dark "ops-console" re-skin of the dashboard exists in the design doc as a comparison option only —
do not build it.

## Shell

Fixed 224px left sidebar (Dashboard, Tickets, Users, Reports, Knowledge Base, Settings) + 56px
topbar (⌘K search, notification bell, New ticket, avatar). Demo persona is agent "Dana Reyes";
brand name is "Deskly".
