# Changelog

All notable changes to Deskly are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Responsive layout pass (mobile / narrow screens).** The app shell no longer forces a fixed
  224px sidebar at every width: on `lg+` it stays a static two-column grid, and below that the
  sidebar becomes an off-canvas drawer opened by a new **hamburger button** in the topbar (with a
  backdrop, and it closes on navigation). The **ticket detail** view stacks its 312px properties
  rail *below* the conversation on narrow screens (and scrolls as one column) instead of squeezing
  the thread into a sliver; it stays side-by-side on `lg+`, and the header meta row now wraps. The
  fixed-width **ticket list**, **users**, and **reports** tables now scroll horizontally on small
  screens instead of clipping/squishing their columns. Typecheck, lint, tests, build all clean.
- **Accessibility pass on the ticket table and create-ticket modal.** Ticket-list rows are now
  keyboard-operable — `tabIndex`, an `aria-label` ("Open ticket #N"), and Enter/Space activation
  (with a guard so focus on an inner control doesn't also trigger the row). The row and header
  checkboxes became real `role="checkbox"` buttons with `aria-checked` and labels (previously a bare
  `<span onClick>` that keyboards couldn't reach). The create-ticket modal now announces as a dialog
  (`role="dialog"`, `aria-modal`, `aria-labelledby` → the title) and **traps Tab focus** within
  itself; its Subject/Category/Description fields are programmatically associated via `htmlFor`/`id`,
  and the Priority segmented control is a labelled `role="group"` with `aria-pressed` on each option.
  A branded `:focus-visible` ring was added globally so keyboard focus is consistently visible
  (fields that manage their own ring are unaffected — no double outline). Typecheck, lint, tests,
  build all clean.
- **Removed fake/dead frontend controls (the "no fake controls" rule).** Swept the UI for affordances
  that rendered but weren't backed by real behaviour: the sidebar's **Saved views** section (hardcoded
  counts 8/18/7/21, a hardcoded-active row, and links that applied no filter) and the **Tickets nav
  count badge** (static `24`) are gone; the header **select-all checkbox** now actually toggles every
  filtered row (was a no-op affordance); ticket #1042 is **no longer pre-selected** on load (was a
  hardcoded selection that popped the bulk bar); the login **"Forgot?"** link (which pointed back at
  `/login` with no reset flow behind it) is removed; the dashboard stat cards no longer show
  **fabricated trend deltas** ("▲ 4.2%", and an "▲ 12" that was even coloured red/down) — only real
  figures remain — and the fake **"view breach queue →"** CTA is dropped; the "Tickets by status"
  chart's **"Last 30 days ▾"** faux-dropdown is removed (no picker existed, and the data isn't
  30-day-windowed). Typecheck, lint, tests, and build all clean.
- **Frontend i18n gaps (TH/EN).** Several shipping surfaces were hardcoded English and ignored the
  language toggle; all now go through `t()` with TH + EN dictionary entries: the entire **create-ticket
  modal** (title, labels, placeholders, KB-deflection banner, dropzone, buttons, errors), the ticket
  **properties rail**, the **ticket detail view** (loading/not-found/error states, role labels,
  internal-note badge), the **users page** (column headers, role chips, loading/empty/error), and the
  **attachments/history/status-menu** panels (plus a missing attachments error state). Fixed two
  raw-label bugs where the **reports "SLA by priority"** table and the **ticket history** showed
  English status/priority names even in Thai (they used the domain `*_META.label` fields instead of
  `t()`). Dates in the users page, ticket detail, and history now localize with the active language
  (`th-TH`/`en-US`) instead of the ambient locale, and the notification "time ago" strings are
  translated. Typecheck, lint, unit tests, and production build all clean.

### Added

- **Log aggregation (Grafana Loki shipping).** Structured JSON logging to stdout is still the
  always-on baseline (what any infra shipper scrapes), but setting `LOKI_URL` now ALSO ships logs to
  a Grafana Loki endpoint via `pino-loki` — batched in a worker thread so it never blocks the event
  loop, with `silenceErrors` so a flaky Loki can't spam the app, and labelled `{app, env}`. Basic
  auth (`LOKI_USERNAME`/`LOKI_PASSWORD`) is supported for Grafana Cloud. With no `LOKI_URL` the
  production fast path (plain stdout, no worker) is unchanged. A new `docker-compose.logging.yml`
  override runs Loki + Grafana (datasource pre-provisioned) for local end-to-end testing. Verified:
  after generating traffic, `{app="deskly-api"}` returns the request logs in Loki, and the existing
  secret **redaction still applies to shipped logs** (the `authorization` header arrives as
  `[Redacted]`, no bearer token leaks).
- **S3 storage adapter is now implemented (was a throwing placeholder).** With `STORAGE_DRIVER=s3`,
  attachments are stored in and served from any S3-compatible bucket via `@aws-sdk/client-s3`. It
  supports both real AWS S3 (default credential chain / IAM role, regional endpoint) and
  S3-compatible servers like MinIO (custom `S3_ENDPOINT` + path-style addressing + explicit keys);
  `getUrl` honours an optional `S3_PUBLIC_URL` (CDN) and otherwise returns `s3://bucket/key`. Boot
  validation requires `S3_BUCKET` when the driver is `s3`, and requires explicit credentials
  whenever a custom endpoint is set. A new `docker-compose.s3.yml` override spins up MinIO plus a
  one-shot bucket-init sidecar so the adapter can be exercised end-to-end locally without touching
  the default (local-storage) stack. Verified end-to-end: upload → object present in MinIO →
  authed download returns a byte-identical file.

### Changed

- **Production build no longer ships test code.** `npm run build` now uses a dedicated
  `tsconfig.build.json` that excludes `*.test.ts` and `test/`, so `dist/` (and the runtime Docker
  image) no longer contains compiled test files that pulled `vitest` into production. `typecheck`
  still checks tests. Vitest also explicitly excludes `**/dist/**` so a stale build never pollutes a
  local `vitest run`.

### Added

- **Fail-fast secret validation at boot.** A new `validateEnv()` guard runs before the server binds
  its port. `DATABASE_URL` is required in every environment; in **production** it additionally
  refuses to start unless both `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are set explicitly, are
  not the code's dev-fallback values, are ≥32 chars, and differ from each other — catching the
  classic "shipped the dev secret" mistake instead of silently signing forgeable tokens. A
  Secure-less cookie in production is logged as a non-fatal warning. Errors never print secret
  values, only the offending variable names. `docker-compose.yml` and `.env.example` document the
  requirement; the local compose stack now ships unique ≥32-char secrets (not the dev fallbacks).
  Covered by 7 unit tests. Verified live: prod + a dev-default secret exits 1 with a fatal log; prod
  + strong secrets boots normally.
- **Liveness & readiness probes.** A new `health` module serves `GET /api/v1/health` (liveness —
  process up, no dependency checks, so a DB blip never triggers a restart) and `GET /api/v1/ready`
  (readiness — pings the DB, returns `503 not_ready` when it's down). The compose `api` service now
  has a readiness-gated healthcheck (via node's global `fetch`, no curl/wget needed) and `web` waits
  for `api` to be **healthy** before starting; the CI e2e wait uses `/ready` too. Verified: with
  Postgres stopped, `/health` stays 200 while `/ready` returns 503, and both recover when it's back.
- **Playwright end-to-end tests.** A `frontend/e2e/` suite (7 specs, Chromium) drives the real
  running stack through the critical journeys: auth guard redirect, sign-in → dashboard shell,
  ticket search → empty state, List/Board toggle, live KB deflection in the create modal, and KB
  browse/filter/open. Runs locally via `npm run e2e` against `docker compose`, and a new CI `e2e`
  job spins up the full stack, seeds the DB, and runs the suite (HTML report uploaded on failure).
  Vitest is now scoped to `src/**` so it and Playwright don't collect each other's specs.
- **Settings page is now real (was a "coming soon" placeholder).** `/settings` shows the signed-in
  user's account (avatar, role badge, email read-only) with an **editable display name** backed by a
  new self-service `PATCH /users/me` (any authenticated user, own account, audited — distinct from
  the admin-only role/team edit); on save the in-memory auth user updates immediately. It also
  surfaces the **language preference** (EN/ไทย) and a **Sign out** action. Fully translated (TH/EN).
- **Bulk ticket actions now work (was a dead toolbar).** Selecting rows in the ticket list shows a
  toolbar whose **Assign / Status / Priority** menus are now functional: each applies to every
  selected ticket via new authed, row-scoped, audited endpoints — `PATCH /tickets/:id/assignee`
  (validates the assignee, notifies) and `PATCH /tickets/:id/priority` (re-derives the SLA `due_at`
  for the new priority) alongside the existing status PATCH. The client fans out per ticket so a
  single failure (e.g. an illegal status transition on one ticket) is counted and reported
  ("N updated · M failed"), not fatal. Toolbar is translated (TH/EN) and gated to write-capable roles.
- **Knowledge Base is now a real feature (was a "coming soon" placeholder).** The `kb` backend
  module grew from a single hardcoded 3-item `/suggest` into a curated 6-article dataset (with
  categories, tags, read time, and full markdown-lite bodies) served by `GET /kb` (search + category
  filter, `meta.categories`), `GET /kb/:id` (full article, 404 if unknown), and `GET /kb/suggest`
  (deflection); the module is now behind `requireAuth` like the rest. The frontend adds a **KB
  browser** (`/kb` — search box + category chips + article cards) and an **article page**
  (`/kb/[id]` — rendered body, read time, back link), both translated (TH/EN). The create-ticket
  modal's "suggested articles" box now pulls **live** deflection from `/kb/suggest` based on the
  subject (was a hardcoded list) and links each result to the real article.
- **Ticket pages overhaul (list + detail).**
  - *List:* the filter bar's decorative chips are now **working filters** — Status and Priority
    multi-select dropdowns and an "Assigned to me" toggle that filter the List *and* Board views
    live (composed with the existing search + column sort), a "Clear" action, and an active-filter
    count. The list footer now shows the **real** filtered/total count (`3 of 42 (filtered)`)
    instead of a fake `‹ 1 ›` pager.
  - *Detail:* the header SLA badge is now **coloured by SLA state** (red when breaching, muted when
    met/paused) instead of always-amber; the composer's **"Attach" button actually uploads a file**
    to the ticket (and the attachment panel refreshes); the dead "⋯" button was removed; and the
    page/composer are now translated (TH/EN).
- **Reports page overhaul.** The resolution-trend chart now **scales to its data** (it previously
  plotted raw counts as pixel coordinates, so the line was pinned to the top and effectively flat)
  and is correctly titled "Tickets resolved per day · last 7 days" with day labels computed from the
  real 7-day window (was mislabelled "Avg resolution time by week" with five fixed week labels for a
  seven-point daily series). The fabricated KPI deltas (`▼ 1.1 h`, etc.) are replaced with honest
  captions backed by two new API fields (`resolvedCount`, `judgedCount`), the SLA-by-priority table
  gained an "All priorities" totals row, **Export CSV now actually works** (downloads a UTF-8 CSV of
  KPIs + trend + SLA table), and the five dead decorative tabs and non-functional date-range
  dropdown were removed. The whole page is now translated (TH/EN). Later gained **by-category SLA
  compliance** and **by-agent resolution throughput** breakdowns (both row-scoped, shown on the page
  and included in the CSV) — the real deep-dive the removed fake tabs had only pretended to offer.
- **Attach files when creating a ticket.** The New-ticket modal's drop zone is now a working
  uploader — click-to-browse or drag-and-drop, multiple files, each shown with size and a remove
  button. Accepts images plus data files (PDF, Excel `.xls`/`.xlsx`, CSV) per the backend allowlist
  (25 MB each); files upload to the new ticket right after it's created, with a clear message if any
  fail to attach.
- **View attachments from the ticket page.** Attachments in the ticket-detail rail now open in a new
  tab when clicked — images and PDFs preview inline (served with `Content-Disposition: inline` via a
  `?disposition=inline` option on the authed download endpoint); other types fall back to a download.
  Each row has an explicit **view (eye)** button plus a separate **download** button.
- **Sortable ticket-list headers.** Each column header (ID, Subject, Status, Priority, Assignee,
  Category, SLA due) is now a click-to-sort button with a direction caret; clicking toggles
  asc/desc. Sorting is domain-aware, not lexical — **Priority** orders Critical → High → Medium →
  Low, **Status** follows the lifecycle order (`new → … → closed`), and **SLA due** orders by
  remaining time (overdue first, paused/resolved last).
- **Tickets Board (kanban) view** — the tickets page's List/Board toggle is now functional (it had
  been an inert placeholder). Board groups tickets into columns by status with clickable cards
  (id, subject, priority, assignee, SLA); the toggle labels are translated.
- **Thai / English language switch** — a lightweight i18n layer (dictionary + `LanguageProvider` +
  `useI18n().t` with interpolation, choice persisted in `localStorage`) and an EN/ไทย toggle in the
  topbar and on the login page. Translated: the shell (sidebar, topbar, notifications), status &
  priority labels, common states, login, the dashboard (greeting + localized date, stat cards,
  charts, my-tickets), page titles, and the ticket-list headers. Deeper strings (create modal,
  filter bar, ticket-detail composer) can be added to the dictionary incrementally.
- **Ticket status history** — `GET /tickets/:id/history` returns the ticket's status timeline from
  `ticket_status_history` (scoped like the ticket itself; each entry has from/to status, actor, and
  timestamp). The ticket-detail rail's History section now renders this real timeline (it had been
  removed when the hardcoded version was stripped).
- **Ticket lifecycle rules** — the two time-based spec rules are now enforced: reopening a ticket
  (`closed → open`) is rejected with `409 REOPEN_WINDOW_EXPIRED` once it has been closed more than
  30 days (open a new ticket instead); and tickets left `resolved` for more than 72 h are
  auto-closed by an hourly background sweep (`AUTO_CLOSE`, on by default) that writes the usual
  status-history + audit + notifications. The ticket payload now includes `closedAt`.
- **Docker & CI** — multi-stage Dockerfiles for the backend (build → Prisma-generated runtime that
  runs `prisma migrate deploy` on start) and the frontend (Next standalone), a full-stack
  `docker-compose.yml` (postgres + api + web), and a GitHub Actions workflow that typechecks, lints,
  tests (unit + integration against a Postgres service), and builds both packages. Both images
  build cleanly.
- **Frontend component tests** — a Vitest + React Testing Library (jsdom) suite (6 tests, `npm test`
  in `frontend/`) for `StatusBadge`, the role-gated `StatusMenu` transition dropdown, and the
  `NotificationsBell` (unread badge / open-and-read / empty state), with query hooks mocked.
- **Backend tests** — a Vitest **unit** suite (19 tests, `npm test`) over the load-bearing domain
  logic: the status-transition whitelist (`canTransition`), SLA derivation
  (`deriveSla`/`computeDueAt`), and RBAC grants (`permissionsFor`/`hasPermission`); plus a supertest
  **integration** suite (25 tests, `npm run test:integration`) against an isolated `deskly_test`
  database (schema via `prisma db push`, reseeded per test) covering auth (login, refresh rotation +
  reuse-detection, logout), ticket RBAC row-scoping + the general unassigned queue, the 409
  transition guard, 403 on requester writes, 404 on out-of-scope access, create-ticket 201/400,
  comments + internal-note visibility, notifications (fire-on-transition + read), attachments
  (upload/list/download + type filter), and users (directory RBAC + admin-only role change).
- **Users module** — a staff directory: `GET /users` and `GET /users/:id` (permission `user:read`,
  granted to agents/managers/admins) plus `PATCH /users/:id` to change a user's role or team
  (admin-only `user:write`, audited). The Users page is now a real directory table (name, email,
  role, team, joined) instead of a placeholder.
- **File attachments** — upload files to a ticket (`POST /tickets/:id/attachments`, multipart via
  multer, 25 MB cap), list them, and download via an authed, scoped endpoint
  (`GET /attachments/:id`). Bytes are stored through the `IFileStorage` adapter (local on disk;
  only metadata + the storage key live in the DB), and every upload is audited. The ticket payload's
  `attachments` count is now a real `_count`. The ticket detail rail lists attachments with upload
  and download wired.
- **Notifications** — ticket status changes and new comments fire per-user notifications to the
  requester and assignee (never the actor; internal notes never reach the requester), written in
  the same transaction as the mutation. `GET /notifications` (with an unread count),
  `POST /notifications/:id/read`, and `POST /notifications/read-all`. The topbar bell shows the
  live unread count with a dropdown to read or open each notification, polling every 30s.
- **Ticket comments** — a real conversation thread: `GET`/`POST /tickets/:id/comments` and
  `DELETE /comments/:id` (soft delete). Public replies vs. agent-only internal notes — requesters
  can neither see nor post internal notes (`403`); access follows the ticket's row scope, and
  every create/delete is audited. The ticket detail view renders the real description and comments
  (with internal-note styling) instead of hardcoded content, and the composer posts live. The
  ticket payload gained `description` and `createdAt`.
- **Create ticket + categories + audit trail** — real `POST /tickets` (requires `ticket:create`):
  the authenticated user becomes the requester, `due_at` is computed from the priority, and the
  status-history row plus an `audit_logs` row are written in the same transaction. Unassigned
  tickets route to their category's default-team queue via the repository scope. New
  `GET /categories`. An `audit_logs` trail records every mutation
  (`auditRepository.record(entry, tx)`), including status changes. The create-ticket modal is now
  a live form that fetches categories, creates, and navigates to the new ticket.
- **RBAC + row-level scoping** — a `requirePermission` middleware gates actions by permission
  (admins hold `*`); changing a ticket's status now requires `ticket:write`. Read access is
  scoped in the repository: requesters see only their own tickets, agents their team's queue,
  managers their department, admins everything — an out-of-scope ticket returns `404` rather than
  leaking its existence. The access token carries `teamId`/`department` to drive scoping. The
  frontend wires the status control + "Mark resolved" to the live write path and hides write
  controls from requesters.
- **PostgreSQL + Prisma** — the tickets module now runs on Postgres via **Prisma** (ORM + Prisma
  Migrate) instead of in-memory data. Normalized schema (`teams`, `users`, `categories`,
  `tickets`, `ticket_status_history`); the repository cutover leaves the service, controller, and
  API contract unchanged. Status changes append a `ticket_status_history` row in a transaction;
  `slaDue`/`slaState` are computed from `due_at`. `docker-compose.yml` provisions Postgres and a
  seed reproduces the demo data.
- **Authentication (JWT + rotating refresh)** — real `/auth/login`, `/refresh`, `/logout`, `/me`.
  A 15-minute access token (memory-only on the client, carrying `role` + `permissions[]`) plus a
  7-day httpOnly refresh cookie with rotation and reuse-detection (a replayed token revokes the
  whole family). Passwords are hashed with bcryptjs; only the SHA-256 hash of a refresh token is
  stored. A `requireAuth` middleware protects `tickets`/`dashboard`/`reports`. The frontend keeps
  the access token in memory, silently refreshes on 401, guards the app shell, and wires
  login/logout.
- **Frontend ↔ backend integration** — the web app now reads live data from the API via a
  `fetch` client (`src/lib/api-client.ts`) and **TanStack Query**. Each feature has zod
  `schemas.ts` + `api.ts` + `queries.ts`; dashboard, ticket list, ticket detail, and reports
  fetch at runtime with loading / error / empty states. Added `slaState` to the tickets payload.
- **Backend logging** — structured logging with `pino` + `pino-http`: per-request `reqId`
  (honours inbound `x-request-id`, echoed in the response header), status-based log levels, and
  redaction of `authorization` / `cookie` headers. Errors log through the request-bound logger.
- **Backend API** — Express + TypeScript service at `/api/v1` with vertical-slice modules
  (`auth`, `tickets`, `dashboard`, `reports`, `kb`), repository pattern (in-memory demo data),
  `IFileStorage` storage adapter, typed errors, and a ticket status-transition guard
  (`409 ILLEGAL_TRANSITION`).
- **Frontend web app** — Next.js 15 (App Router) implementation of six screens from the Claude
  Design handoff: Login, Dashboard, Ticket list, Ticket detail, Reports, and the Create-ticket
  modal, matching the Deskly design tokens.
- **Docs** — `docs/DEVLOG.md`, `docs/ROADMAP.md`, and this changelog.

### Changed

- The ticket-detail **"Mark resolved"** button is now a light-brown fill (`#efe0cd` / brown text)
  instead of a plain grey outline, tying it to the brand palette.
- **Theme rebrand — brown / cream / green.** The primary colour is now brown (`#7d5329`, replacing
  the blue brand token) and the app background is cream (`#f6efe1`). Green (`#3f8f5e` / soft
  `#e4f2ea`) is the accent for active & selected states (nav, saved views, selected rows, filter
  chips, KB deflection, priority toggle) and the login hero. Status and priority colour scales are
  semantic and were left unchanged.
- **Dashboard & reports are now computed from the database** instead of returning static demo
  numbers. `dashboard/summary` derives ticket counts, status/priority breakdowns, unassigned,
  closed-this-week, average resolution time, and SLA-risk counts; `reports/sla-summary` derives
  average resolution, SLA compliance (from `resolvedAt` vs `due_at`), a 7-day resolution trend, and
  per-priority met/breached. Both are proper vertical slices (repository → service → controller) and
  keep the existing response shape. (Aggregates are global; per-user scoping is a future refinement.)
- Repository split into `frontend/` and `backend/` packages (no root `package.json`).

### Fixed

- **Dashboard & Reports are now row-scoped like the ticket list.** Their aggregates were computed
  globally, so a requester's dashboard showed company-wide totals even though their ticket list
  (correctly) showed only their own — a data-exposure inconsistency. The ticket repository's
  row-scope clause was extracted into a shared `ticketScopeWhere(user)` and applied to every
  dashboard and reports query, so managers see their department, agents their team, requesters their
  own — and `dashboard.totalTickets` now matches the scoped ticket-list count for every role.
- **Uploaded attachments now persist across container rebuilds.** The API stored files under
  `./.uploads` inside the container's ephemeral filesystem, so rebuilding/recreating the `api`
  service silently orphaned every attachment (the DB row survived but the file was gone → downloads
  404'd). The compose stack now mounts a named `deskly-uploads` volume at `/data/uploads` and points
  `LOCAL_STORAGE_DIR` there. Verified: a file uploaded, then `docker compose up --force-recreate api`,
  still downloads intact.
- **Search boxes are now real inputs.** The topbar search and the tickets filter-bar search were
  static markup (a `<button>` / a `<div>`) that couldn't be typed into. Both are now real `<input>`s
  backed by a shared `SearchProvider`: typing filters the tickets **List and Board** views live
  (matching subject, `#id`, or requester), the topbar search jumps to `/tickets` on Enter, and the
  placeholders are translated (`filter.search`).
- Unassigned tickets in a category with no default team are no longer invisible to staff: agents and
  managers now see a **general unassigned queue** (unassigned + `category.defaultTeamId = null`), per
  the spec's fallback queue. Requesters still see only their own tickets.
- Per-ticket SLA is now computed, not assumed: a `Ticket.resolvedAt` timestamp (set when a ticket
  reaches `resolved`) is compared against `due_at`, so `deriveSla` reports **met** only when the
  ticket was resolved on time and **breached** otherwise. (The `/reports` compliance figures remain
  static demo data.)
- Refresh-cookie `Secure` flag is now driven by `COOKIE_SECURE` (default follows `NODE_ENV`) instead
  of being hardwired to production — so the docker-compose stack (production mode over plain HTTP)
  can serve a storable cookie (`COOKIE_SECURE=false`) while TLS deploys keep `Secure` on.
- "My tickets" and the dashboard greeting now use the signed-in user (via `useAuth`) instead of a
  hardcoded "Dana Reyes" / fixed date. The ticket-detail properties rail shows only real data
  (status, priority, assignee, category, requester, SLA due, attachments); the previously hardcoded
  Department, Linked-KB, first-response metric, SLA progress bar, and History timeline were removed
  (no backing data yet — a real history view needs a `ticket_status_history` endpoint).

### Security

- Hardening: per-IP rate limit on `POST /auth/login` (`express-rate-limit`, `AUTH_RATE_LIMIT`),
  a 1 MB `express.json` body cap, an upload content-type allowlist (on top of the 25 MB limit),
  pruning of expired refresh tokens on login, and an error handler that returns the correct status
  for oversized (413) / malformed (400) request bodies instead of 500.
- Bumped Next.js `15.1.6 → 15.5.20` to fix **CVE-2025-66478** (dev-server origin exposure) and
  other Next advisories — the critical `npm audit` finding is cleared. Added a
  `next/core-web-vitals` ESLint config so `next lint` runs non-interactively (there was none
  before). Two moderate advisories remain in Next's *bundled* postcss (build-time only; not
  fixable without downgrading Next) pending an upstream release.

### Notes

- Phases 4–6 are complete (all modules · 40 tests · Docker + CI · Next security bump). Still to
  come: Phase 7 deploy tooling (S3 storage, health probes, secrets) and Playwright e2e in CI. See
  `docs/ROADMAP.md`.
- The tickets `attachments` field is a placeholder `0` pending the Attachment model; SLA policy
  hours in `sla.ts` are placeholder defaults. This npm environment blocks package post-install
  scripts, so run `npx prisma generate` explicitly after `npm install`.

[Unreleased]: https://example.com/deskly/compare/main...HEAD
