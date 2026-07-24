# Deskly — Development Roadmap

จัดลำดับให้ระบบ "ใช้งานได้จริง end-to-end" ให้เร็วที่สุด แล้วค่อยเสริมความครบถ้วน / คุณภาพ / deploy
สถานะ: ✅ เสร็จ · 🔜 ถัดไป · ⬜ วางแผนไว้

---

## ✅ ก่อนหน้า — Foundation
- Frontend Next.js 15 (6 หน้าจอจาก Claude Design, mock data)
- แยก monorepo `frontend/` + `backend/`
- Backend Express + TS `/api/v1` (auth stub, tickets, dashboard, reports, kb; in-memory)

## ✅ Phase 0 — Logging & docs
- Structured logging (pino + pino-http): reqId, level ตาม status, redact secrets
- errorHandler log ผ่าน `req.log` (ผูก reqId)
- เอกสาร DEVLOG / CHANGELOG / ROADMAP

## ✅ Phase 1 — เชื่อม Frontend ↔ Backend
- `frontend/src/lib/api-client.ts` (fetch wrapper, base URL จาก `NEXT_PUBLIC_API_URL`, credentials)
- TanStack Query + `QueryClientProvider`
- แต่ละ feature: `api.ts` + `queries.ts` + `schemas.ts` (zod) → ดึงจาก API จริง
  (`tickets`, `dashboard`, `reports`) พร้อม loading / error / empty states + client logger
- **ค้าง:** ผูกปุ่ม mutation (เปลี่ยน status) และ POST create-ticket จริง

## ✅ Phase 2 — PostgreSQL (แทน in-memory)
- docker-compose service `postgres` (postgres:16-alpine) + healthcheck
- data layer เลือกใช้ **Prisma** (ORM + Prisma Migrate) — import client เฉพาะใน repository / seed / singleton
- schema (normalized): `teams`, `users`, `categories`, `tickets`, `ticket_status_history` (SLA source of truth); enums ตรงกับ `shared/domain.ts`
- tickets repository cutover เป็น Prisma — **แตะเฉพาะ repository layer**; service/controller/API contract/frontend ไม่เปลี่ยน
- `updateStatus` ใช้ `$transaction` เขียน `ticket_status_history`; `sla.ts` คำนวณ `slaDue`/`slaState` จาก `due_at` + status (ไม่เก็บใน DB)
- seed จากข้อมูล demo เดิม (คง ticket id 4 หลัก + reset sequence)

## ✅ Phase 3 — Auth & RBAC
**Auth**
- JWT access (15 นาที, in-memory ฝั่ง client, พก `role` + `permissions[]` + `teamId`/`department`) + refresh (7 วัน, httpOnly cookie, rotate + reuse-detection → revoke ทั้ง family)
- bcryptjs hash password; `RefreshToken` model เก็บเฉพาะ SHA-256 hash
- middleware `requireAuth` (Bearer → `req.user`); ป้องกัน `tickets`/`dashboard`/`reports`; `/login` `/refresh` `/logout` `/me`
- Frontend: token store ใน memory, `api-client` 401→refresh→retry, `AuthProvider` + guard + bootstrap ผ่าน refresh cookie, `/login` เรียก API จริง, sidebar sign out

**RBAC**
- middleware `requirePermission` (เช็ค permission; admin ถือ `*`); PATCH status ต้องมี `ticket:write`
- row-level scoping ใน repository (WHERE): requester=ของตัวเอง, agent=own+คิวทีม, manager=own+แผนก, admin=ทั้งหมด — นอก scope = 404 (ไม่รั่วว่ามีอยู่)
- Frontend ผูกปุ่มเปลี่ยน status (StatusMenu + Mark resolved) เข้ากับ write path จริง; requester ไม่เห็นปุ่ม (ไม่มี `ticket:write`)

## ✅ Phase 4 — Backend modules ที่เหลือ
เพิ่มทีละ vertical slice (routes/controller/service/repository/validators):
- ✅ `categories` (GET list) + auto-assignment ผ่าน `default_team_id` (unassigned → คิวทีมตาม scope)
- ✅ create-ticket POST จริง (perm `ticket:create`) + ผูก modal ฝั่ง FE (fetch categories → สร้าง → navigate)
- ✅ `audit` — `audit_logs` + `auditRepository.record(entry, tx)` เขียน audit row ใน tx เดียวกับ mutation (create, status change, comment)
- ✅ `comments` — public reply + internal note (เฉพาะ role ที่มี `ticket:write`), soft-delete (`deleted_at`), scoped ตาม ticket; ผูก thread ในหน้า detail
- ✅ `notifications` — ยิงตอน status transition + comment ใหม่ (requester/assignee ยกเว้น actor; internal ไม่ถึง requester); bell + dropdown (unread badge, mark read/all, poll 30s)
- ✅ `attachments` — upload จริง (multer + `IFileStorage`, จำกัด 25MB), list + download แบบ authed/scoped, `attachments` count จริงใน ticket DTO; ผูก panel ในหน้า detail
- ✅ `users` — directory list/get + update role/team; RBAC `user:read` (admin/manager/agent) / `user:write` (admin); หน้า Users จริง
- ✅ `kb` — บทความจริง 6 เรื่อง (list + search + category filter + detail + suggest, behind `requireAuth`); หน้า `/kb` (browser) + `/kb/[id]` (article) + deflection สดใน create modal
- ✅ bulk ticket actions — `PATCH /tickets/:id/assignee` + `/priority` (scoped/audited/notify, priority re-derive dueAt); toolbar เลือกหลายตั๋ว (Assign/Status/Priority) fan-out + รายงาน failed
- ✅ หน้า Settings จริง — self-service `PATCH /users/me` (แก้ชื่อตัวเอง, audited); Account + สลับภาษา + Sign out
- ✅ dashboard/reports row-scoped — แยก `ticketScopeWhere` เป็น shared, apply ทุก aggregate (dash.total ตรงกับ ticket list ทุก role)
- ✅ reports เชิงลึก — breakdown by-category (SLA compliance) + by-agent (throughput + avg time), scoped, อยู่ในหน้า + CSV

## ✅ Phase 5 — Testing (skill `senior-qa`)
- ✅ backend unit (Vitest): transition guard (`canTransition`), SLA (`deriveSla`/`computeDueAt`), RBAC (`permissionsFor`/`hasPermission`) — 19 tests, pure/no-DB
- ✅ backend integration (supertest, test DB `deskly_test`): auth (login/401/guard), tickets RBAC scoping + 409 transition + 403 write + 404 out-of-scope, create 201/400, comments internal 403/visibility — 15 tests
- ✅ frontend component (Vitest + RTL + jsdom): StatusBadge, StatusMenu (RBAC/transition), NotificationsBell — 6 tests, hooks mocked
- ✅ Playwright e2e — `frontend/e2e/` 7 specs (Chromium) รันกับ stack จริง: auth guard/redirect, login→dashboard, ticket search→empty, List/Board toggle, KB deflection ใน create modal, KB browse/filter/open; `npm run e2e` (local) + CI job

## ✅ Phase 6 — Docker & CI/CD
- ✅ multi-stage `Dockerfile` — backend (deps → prisma generate + tsc → runtime `migrate deploy` + node) และ frontend (Next `output:standalone`) + `.dockerignore`; **build ผ่านจริงทั้งคู่** (`helpdesk-api`, `helpdesk-web`)
- ✅ `docker-compose.yml` full stack (postgres + api + web, `depends_on` healthy, build args); DB-only ยังใช้ `docker compose up -d postgres`; ไฟล์แนบเก็บบน named volume `deskly-uploads:/data/uploads` (persist ข้าม rebuild)
- ✅ GitHub Actions `.github/workflows/ci.yml`: backend (postgres service → prisma generate, typecheck, unit + integration test, build) + frontend (typecheck, lint, test, build)
- ✅ bump Next `15.1.6 → 15.5.20` (แก้ CVE-2025-66478 + advisories อื่นในสาย 15.x) + เพิ่ม ESLint config (`next lint` ทำงานจริง ไม่ prompt)
- ✅ Playwright e2e ใน CI — job `e2e`: `docker compose up --build` → wait health → seed → `playwright test` (อัป HTML report ถ้า fail)

## ✅ Phase 7 — Deploy & Ops
- ✅ health/readiness probes — `/api/v1/health` (liveness) + `/ready` (DB-gated, 503 เมื่อ DB ล่ม); compose api healthcheck (readiness-gated) → `web` รอ api healthy
- ✅ migration runner ตอน deploy — Dockerfile CMD `prisma migrate deploy` ก่อน start (มีอยู่แล้ว)
- ✅ env/secret management — `validateEnv()` fail-fast ตอน boot: DATABASE_URL บังคับทุก env; prod บังคับ
  JWT secret ตั้งเอง (ไม่ใช่ dev-default), ≥32 ตัว, access≠refresh; COOKIE_SECURE=false เตือน (ไม่ fatal);
  log ไม่โชว์ค่า secret; compose/.env.example อัปเดต + 7 unit tests
- ✅ storage adapter → `S3Storage` (prod / S3-compatible) — `@aws-sdk/client-s3`, path-style + custom
  endpoint สำหรับ MinIO, credential chain สำหรับ AWS จริง; validateEnv บังคับ S3_BUCKET (+ keys ถ้ามี
  endpoint); `docker-compose.s3.yml` เพิ่ม MinIO + bucket init สำหรับเทสต์ end-to-end ในเครื่อง (verified:
  upload→object ใน MinIO→download byte-match)
- ✅ log ส่งเข้า aggregator — stdout JSON เป็น baseline เสมอ; ตั้ง `LOKI_URL` → ship เข้า Grafana Loki ผ่าน
  `pino-loki` (batch ใน worker thread, silenceErrors, labels `{app,env}`, basic-auth optional สำหรับ
  Grafana Cloud); `docker-compose.logging.yml` เพิ่ม Loki + Grafana (datasource provisioned) เทสต์ในเครื่องได้
  (verified: query `{app="deskly-api"}` เห็น log จริง + redaction ยังทำงานบน log ที่ ship — authorization = `[Redacted]`)

## ✅ Phase 8 — Realtime chat, integrations & horizontal scaling

**Login UX**
- ✅ redesign หน้า login เป็นการ์ดคอลัมน์เดียวกลางจอ (พื้น cream ตามธีม) + ไอคอนในช่อง +
  โชว์/ซ่อนรหัสผ่าน + ลิงก์ "ลืมรหัส?" + ปุ่ม **one-click demo login** (กรอก+ล็อกอินทันที)

**Ticket import & external sources (`integrations` module)**
- ✅ **CSV import** — parse ฝั่ง client (รองรับ quote/comma/newline + header aliases), grid แก้ไขได้ +
  validate สด (category/priority เป็น dropdown, email/subject), ปุ่ม disable จนครบ; backend `importMany`
  (perm `ticket:import` — agent+) resolve category-name→id + email→user, partial success ต่อแถว
- ✅ **external source adapter** (`ITicketSource` + registry, แนว `IFileStorage`) — `MockSource` (รันได้จริง)
  + `Jira`/`Zendesk`/`imap-email` stub (configured จาก env, `fetchTickets` โยน 501); `GET /integrations/sources`
  + `POST /integrations/sources/:id/sync` (reuse `importMany`); หน้า Settings > Integrations แสดงสถานะ + Sync
- ✅ **email-to-ticket (webhook)** — `POST /integrations/email-inbound` public + shared-secret (constant-time);
  normalize payload (SendGrid/Mailgun/generic), parse priority จาก subject tag, category ดีฟอลต์,
  auto-create requester ถ้าผู้ส่งใหม่; IMAP เป็น stub adapter เตรียมไว้

**Agent email reply (outbound)**
- ✅ composer แท็บ **Reply** เป็นฟอร์มอีเมล (From/To/Body/แนบไฟล์ optional); `POST /tickets/:id/reply`
  (perm `ticket:write`) → บันทึก public comment + ส่งเมลผ่าน mail adapter (`SmtpMailSender` เมื่อตั้ง `SMTP_*`,
  ไม่งั้น `LogMailSender`); เพิ่ม `requesterEmail` ใน ticket DTO

**Attachments UX**
- ✅ preview รูป inline (thumbnail) + **lightbox กลางจอ** (portal → `document.body`)
- ✅ download robustness — ไฟล์หายใน storage → **404 สะอาด** (ไม่ 500) + FE โชว์ข้อความ; แผง Property
  แสดง thumbnail เล็ก + ปุ่ม Preview (link)
- ✅ **ลบไฟล์แนบ** — `DELETE /attachments/:id` (perm `ticket:write`, `IFileStorage.delete` best-effort +
  audit); ปุ่มถังขยะ + ยืนยัน inline (ลบ orphan ที่ไฟล์หายได้)

**Realtime chat**
- ✅ composer แท็บ **Chat** (ค่าเริ่มต้น) — public comment เร็ว, Enter ส่ง; ฟองแชทแยกสี/ฝั่งตาม role
  (requester ซ้าย/ขาว, agent ขวา/เขียว, note เหลือง), group bubbles (ซ่อน avatar/header เมื่อติดกัน),
  auto-scroll ไปข้อความล่าสุด
- ✅ **SSE** แทน polling — `GET /tickets/:id/comments/stream` (`text/event-stream`, scope-checked, กรอง internal
  เฉพาะ agent, heartbeat); FE consume ด้วย fetch-reader (ส่ง bearer token ได้), dedup + auto-reconnect
  (delivery ~30–50ms)
- ✅ **optimistic send** — ข้อความขึ้น thread ทันที (สถานะ `sending`) เคลียร์ช่องพิมพ์เลย →
  สลับเป็น comment จริงตอน server ตอบ (dedup กับ SSE echo ของตัวเอง) / พลิกเป็น `failed` + ปุ่ม retry
  ถ้าส่งไม่ผ่าน (`useCreateComment` onMutate/onSuccess/onError); e2e `optimistic.spec.ts`
- ✅ **typing indicator** — `POST /tickets/:id/comments/typing` (scope-checked) → `bus.emit("typing")`
  fan-out ผ่าน SSE เดิม (ไม่ echo กลับผู้พิมพ์เอง); FE ยิงแบบ throttle ทุก 2.5s ตอนพิมพ์แท็บ chat,
  โชว์ "X กำลังพิมพ์…" (จุดเด้ง) หมดอายุ 4s หลังหยุด + เคลียร์ทันทีเมื่อข้อความมาถึง;
  backend 61 integration, e2e `typing.spec.ts`

**Horizontal scaling**
- ✅ **event bus adapter** (`shared/events.ts`) — `LocalEventBus` (in-process) / `RedisEventBus` (Redis pub/sub)
  เลือกด้วย `REDIS_URL`; comment สร้าง → `bus.emit` → fan-out ทุก instance (verified cross-replica ~46ms)
- ✅ **multi-replica compose** — `docker-compose.scale.yml` (`!reset`/`!override`): API N replicas หลัง nginx LB
  (`nginx.scale.conf`, round-robin ผ่าน Docker DNS + SSE passthrough) + Redis; healthcheck ทั้ง nginx + api
  (verified 3 replicas: SSE ผ่าน nginx รับครบ 3/3 ผ่าน Redis ~157ms); README อัปเดตวิธีรัน

## 🔜 ถัดไป
- ทดสอบครอบคลุมงาน Phase 8:
  - ✅ pure unit — CSV import parser (`csv.test.ts`), email parsers (`email.parsers.test.ts`),
    event bus (`events.test.ts`); backend 48 tests / frontend 19 tests, typecheck ผ่าน
  - ✅ integration (supertest, `deskly_test`) — CSV import (`importMany`: partial success + field-tagged
    fails + 403 requester + 400 empty), external sources (list/mock sync 201/jira 501/unknown 404/403),
    email-inbound webhook (known 201/auto-create requester/wrong+missing secret 403/no-From 400 +
    priority-tag derive), agent reply (public comment + log transport/subject derive/403/404/400 to),
    DELETE attachment (204 + gone/orphan download 404 + delete still 204/403)
  - ✅ SSE stream (real socket) — out-of-scope 404 before open, delivers `comment.created` frame,
    withholds internal notes from requester + forwards public replies; backend 48 unit + 58 integration
  - ✅ e2e realtime chat (Playwright, 2 sessions) — agent chat message appears on the requester's open
    page via SSE with no reload (waits for the subscription to open first, so the push isn't missed);
    full e2e suite 8/8
- Redis event bus: production hardening (reconnect/TLS/auth), ย้าย notifications poll → SSE
- deploy จริง (multi-node behind nginx) + observability สำหรับ SSE connections
