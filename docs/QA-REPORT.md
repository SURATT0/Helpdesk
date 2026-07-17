# Deskly — QA Report

**Date:** 2026-07-10 · **Runner:** Vitest 4.1.10 (v8 coverage) · **DB:** Postgres `deskly_test` (integration)

## Summary

| Suite | Command | Files | Tests | Result |
|---|---|---|---|---|
| Backend unit (pure) | `npm test` (backend) | 3 | 21 | ✅ pass |
| Backend integration (supertest) | `npm run test:integration` | 1 | 25 | ✅ pass |
| Frontend component (RTL) | `npm test` (frontend) | 3 | 6 | ✅ pass |
| **Total** | | **7** | **52** | **✅ 52 / 0** |

All 52 automated tests pass. No failures, no flakes observed across runs. *(Counts updated
2026-07-13 as fixes/tests were added.)*

## Coverage

**Backend — unit run** (pure domain logic): Statements 100% · Branches 90% · Functions 100% · Lines 100%
(covers `shared/domain.ts`, `shared/auth.ts`; `sla.ts` covered via the unit sla suite.)

**Backend — integration run** (whole app via HTTP): Statements 64.5% · Branches 52.2% · Functions 50.3% · Lines 67.4%

| Module | Stmts % | Notes |
|---|---|---|
| `modules/tickets` (service/repo/controller/sla) | **91%** | list/get/create/status + scoping + 409 well covered |
| `modules/comments` | 70% | create/list/internal covered; soft-delete path partial |
| `modules/categories` | 55% | list hit via create-ticket |
| `modules/dashboard` · `reports` | 75% | static endpoints, little logic |
| `shared` (domain/auth/sla/logger 100%) | 69% | `storage.ts` 18%, `db.ts` 62% |
| `modules/auth` (tokens 100%) | ~40% | **login covered; refresh/rotate/reuse/logout NOT automated** |
| `modules/notifications` | 39% | fired indirectly; list/read endpoints not automated |
| `modules/users` | 25% | **not covered by the integration suite** |
| `modules/attachments` | — | **not covered by the integration suite** |

**Frontend — component run** (per loaded file): Statements 42% · Branches 35% · Functions 38% · Lines 43%

| Component | Stmts % |
|---|---|
| `StatusMenu` (RBAC/transition dropdown) | 94% |
| `NotificationsBell` | 73% |
| `StatusBadge` | 50% |

(Pages and untested components aren't loaded by the suite, so they aren't counted — see gaps.)

## Feature coverage matrix

| Feature | Automated | Also verified manually (dev) |
|---|---|---|
| Auth — login / 401 / route guard | ✅ integration | ✅ |
| Auth — refresh rotation + reuse-detection + logout | ✅ integration | ✅ |
| Tickets — list + RBAC row scoping | ✅ integration | ✅ |
| Tickets — status transition guard (409) | ✅ unit + integration | ✅ |
| Tickets — write perms (403) / out-of-scope (404) | ✅ integration | ✅ |
| Tickets — create (201/400) | ✅ integration | ✅ |
| SLA derivation + due-date policy | ✅ unit | ✅ |
| RBAC permissions map | ✅ unit | ✅ |
| Comments — public/internal + visibility + 403 | ✅ integration | ✅ |
| Comments — soft-delete | ⚠️ partial | ✅ |
| Categories — list | ✅ (indirect) | ✅ |
| Notifications — fire on transition + read | ✅ integration | ✅ |
| Attachments — upload/list/download + type filter | ✅ integration | ✅ |
| Users — directory list/get + admin role update | ✅ integration | ✅ |
| Frontend — StatusBadge / StatusMenu / NotificationsBell | ✅ RTL | — |
| Frontend — pages (dashboard/tickets/detail/reports/users/login) | ❌ | ✅ (route-serve + API walk) |

## Gaps & recommendations (prioritized)

1. **✅ DONE (2026-07-13) — P1.** Automated the auth refresh/rotation/reuse-detection + logout path
   (supertest: login → refresh rotates → reuse old token → 401 + family revoked; no-cookie → 401;
   logout → refresh fails).
2. **✅ DONE (2026-07-13) — P1.** Added integration tests for `users` (staff read / requester 403 /
   admin-only role write), `notifications` (fire-on-transition to requester not actor + mark-read),
   and `attachments` (multipart upload → list → authed download + content-type 400). Integration
   suite now 25 tests.
3. **P2 — Frontend page tests / e2e.** No coverage for the six screens end-to-end. Stand up Playwright (deferred from Phase 5) for login → dashboard → ticket detail → status change, with an auth fixture.
4. **P2 — Cover comment soft-delete + the `IFileStorage` adapter** (local save/read) in integration.
5. **P3 — dashboard/reports** return static demo figures; tests are low-value until they compute from the DB.

## Blind spots (2026-07-11 review — bugs/risks beyond "missing tests")

Ranked. "Verified" = confirmed by reading code and/or a runtime probe.

1. **✅ FIXED (2026-07-11).** **[BUG · frontend] "My tickets" is hardcoded to Dana Reyes.** `my-tickets.tsx` filters
   `t.assignee === "Dana Reyes"` (const `CURRENT_AGENT`) instead of the logged-in user — any other
   user sees Dana's tickets, not their own. The dashboard greeting ("Good morning, Dana",
   "Wednesday, July 9") is hardcoded too. → Use `useAuth().user.name`. *Verified in code.*
2. **✅ FIXED (2026-07-11).** **[DEPLOY BUG] Refresh cookie was `Secure` under docker-compose over
   plain HTTP.** The `secure` flag is now driven by `env.cookieSecure` (env `COOKIE_SECURE`,
   default = `NODE_ENV==="production"`), and docker-compose sets `COOKIE_SECURE=false` since it
   serves HTTP. Real deploys behind TLS leave it unset → `Secure` stays on. Verified at runtime:
   prod + `COOKIE_SECURE=false` → cookie has no `Secure`; prod default → `Secure` present.
3. **✅ FIXED (2026-07-11).** **[INTEGRITY] Ticket-detail properties rail was mostly hardcoded.**
   Now Category + SLA (due/state) render real data; the fabricated Department, Linked KB, SLA
   progress bar, first-response metric, and History timeline were removed (no backing data yet).
   A real History section needs a `GET /tickets/:id/history` endpoint over `ticket_status_history`
   (not yet built).
4. **✅ FIXED (2026-07-13) — per-ticket SLA.** **[CORRECTNESS] SLA "met" was not computed.** Added
   `Ticket.resolvedAt` (set on the →resolved transition; seeded for demo resolved/closed tickets);
   `deriveSla` now compares `resolvedAt` vs `due_at` → **met** if on time, **breached** (danger) if
   late. Verified at runtime (met; and breached after forcing `due_at < resolved_at`). *Update
   2026-07-13: `/reports` and `/dashboard` now compute their figures (incl. SLA compliance) from the
   DB — no longer static.*
5. **✅ FIXED (2026-07-13).** **[LATENT] Tickets could become invisible to all agents.** `scopeWhere`
   now gives agents and managers a **general unassigned queue** — unassigned tickets whose category
   has `defaultTeamId = null` are visible to any agent/manager (not just the requester/admins),
   matching the spec's "otherwise the unassigned queue". Covered by a new integration test (a
   team-less unassigned ticket is seen by two different-team agents, hidden from an unrelated
   requester). Existing team-scoping behaviour unchanged.
6. **✅ MOSTLY FIXED (2026-07-13). [SECURITY/OPS] Hardening.** Done: per-IP login rate-limit
   (`express-rate-limit`, `AUTH_RATE_LIMIT`, default 20/15 min → 429); `express.json({ limit: "1mb" })`;
   multer content-type allowlist (rejected → 400) on top of the 25 MB cap; expired refresh tokens
   pruned on login (`deleteExpired`); the error handler now honours body-parser HTTP statuses
   (oversized → 413, malformed JSON → 400 — previously both 500). Verified at runtime.
   **Deliberately left:** the 15-min access token still isn't revocable before expiry on logout
   (accepted JWT trade-off — would need a denylist).
7. **[UNTESTED PATH — verified OK] Login with a non-existent email returns 401, not 500.** The
   malformed dummy bcrypt hash (`$2a$10$invalid…`) makes `bcrypt.compare` return false rather than
   throw — confirmed at runtime. Lock it with a test (the integration suite only covers wrong-password
   on an existing user).

## Verdict

The **load-bearing domain logic** (status-transition guard, SLA, RBAC) and the **core ticket + auth + comments HTTP paths** are well covered and green. The main automation gaps are the newer modules (users, attachments, notifications), the auth refresh flow, and frontend page/e2e tests — all currently covered only by manual verification during development.
