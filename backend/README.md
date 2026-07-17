# Deskly API

Backend for **Deskly** — Express + TypeScript, versioned REST at `/api/v1`.
Clean Architecture with vertical-slice modules; the domain layer knows no
frameworks and services never touch SQL (repository pattern).

## Getting started

```bash
npm install
cp .env.example .env
npm run dev      # http://localhost:4000/api/v1
```

Scripts: `npm run dev`, `npm run build`, `npm run start`, `npm run typecheck`.

## Endpoints (implemented)

| Method | Path                          | Description                        |
| ------ | ----------------------------- | ---------------------------------- |
| GET    | `/api/v1/health`              | Liveness check                     |
| POST   | `/api/v1/auth/login`          | Login (demo stub, issues token)    |
| GET    | `/api/v1/tickets`             | List tickets (`?status=&priority=`)|
| GET    | `/api/v1/tickets/:id`         | Ticket by id                       |
| PATCH  | `/api/v1/tickets/:id/status`  | Change status (transition-guarded) |
| GET    | `/api/v1/dashboard/summary`   | Dashboard stats + chart data       |
| GET    | `/api/v1/reports/sla-summary` | SLA compliance + resolution times  |
| GET    | `/api/v1/kb/suggest?q=`       | KB deflection suggestions          |

## Structure

```
src/
  config/      env + constants
  shared/      domain enums, typed errors, IFileStorage adapter
  middlewares/ asyncHandler, notFound, error handler (AppError + Zod)
  modules/     vertical slices — each owns routes/controller/service/repository/validators
    auth/ tickets/ dashboard/ reports/ kb/
```

## Real-time & horizontal scaling

The ticket thread updates live over **Server-Sent Events** —
`GET /api/v1/tickets/:id/comments/stream`. Every new comment (chat, email reply,
or internal note) is published to an event bus and pushed to subscribers; the
client reads the stream with a `fetch` reader so the in-memory bearer token can
be sent as a header (an `EventSource` can't).

The event bus is a pluggable adapter (`src/shared/events.ts`), selected by env:

- **`REDIS_URL` unset** → `LocalEventBus` (in-process) — single node, dev default.
- **`REDIS_URL` set** → `RedisEventBus` (Redis pub/sub) — fans events out across
  every API instance, so an SSE client on one replica still receives comments
  posted to any other. (Single-node → Redis is a one-env-var change, no code.)

### Running multiple API replicas

`docker-compose.scale.yml` (repo root) overlays the base stack: N API replicas
behind an nginx load balancer (`nginx.scale.conf`), with Redis enabled. Requires
Docker Compose ≥ 2.24 (uses `!reset` / `!override`).

```bash
# multi-replica (3 by default) — nginx ingress on :4000, Redis fan-out
docker compose -f docker-compose.yml -f docker-compose.scale.yml up -d
# custom replica count
docker compose -f docker-compose.yml -f docker-compose.scale.yml up -d --scale api=5
# back to single-node dev
docker compose down --remove-orphans && docker compose up -d
```

nginx re-resolves the `api` service per request (Docker DNS) to round-robin
across replicas, and is tuned for SSE passthrough (no buffering, long read
timeout); both nginx and each API replica expose healthchecks. The browser keeps
targeting `http://localhost:4000` (now nginx), so the pre-built web image needs
no change.

## Status

Phases 0–4 of `docs/ROADMAP.md` are done: PostgreSQL via Prisma, JWT auth with
rotating refresh tokens + RBAC and repository row-scoping, audit logging, and all
spec modules (`users`, `categories`, `comments`, `attachments`, `notifications`,
`audit`, `dashboard`, `reports`, `kb`, `integrations`). Remaining: broader test
coverage, CI, and deploy hardening.
