# Deskly — Development Log

บันทึกงานพัฒนาเรียงตามรอบ (ล่าสุดอยู่บนสุด) — สิ่งที่ทำ · ไฟล์หลัก · ผล verify · สิ่งที่ค้าง

---

## 2026-07-16 · P3 — Log aggregator (ปิด Phase 7) (/senior-fullstack)

**ทำ** (user: ทำ log aggregator ต่อ)
- `shared/logger.ts`: refactor เป็น transport targets — stdout (pretty ใน dev / JSON ใน prod) **เป็น baseline เสมอ**; ถ้าตั้ง `LOKI_URL` เพิ่ม target `pino-loki` (batch worker thread, `silenceErrors`, labels `{app:"deskly-api",env}`, basic-auth optional); prod + ไม่มี Loki = fast path เดิม (plain stdout, ไม่มี worker) — redact ยังทำงานก่อน transport
- `config/env.ts`: เพิ่ม `LOKI_URL`/`LOKI_USERNAME`/`LOKI_PASSWORD`
- `docker-compose.logging.yml` (ใหม่, override): Loki (2.9.8) + Grafana (anonymous admin, port 3001) + datasource provisioned (`deploy/grafana/provisioning/datasources/loki.yml`); override api `LOKI_URL=http://loki:3100`
- `.env.example`: เอกสาร Loki vars

**ไฟล์หลัก** — `backend/src/shared/logger.ts`, `backend/src/config/env.ts`, `docker-compose.logging.yml`, `deploy/grafana/provisioning/datasources/loki.yml`, `backend/.env.example`, `backend/package.json` (+`pino-loki`)

**Verify** — typecheck/unit 28/28/build clean; **e2e จริงกับ Loki**: `up -f docker-compose.logging.yml` → api healthy (LOKI_URL set) → gen traffic → query Loki `{app="deskly-api"}` = **2 streams / 14 lines** (labels ถูก), content เป็น pino request logs จริง; **security: redaction บน log ที่ ship** — authorization=`[Redacted]`, ไม่มี raw bearer token; revert กลับ default (LOKI_URL unset, stdout baseline ยัง emit JSON)

**Phase 7 ครบแล้ว** (health probes ✅ · migration runner ✅ · secret mgmt ✅ · S3 ✅ · log aggregator ✅)

---

## 2026-07-16 · P3 — S3Storage adapter (/senior-fullstack)

**ทำ** (user: ทำ S3Storage adapter ต่อ)
- `shared/storage.ts`: implement `S3Storage` (เดิม throw placeholder) ด้วย `@aws-sdk/client-s3` — `save`=PutObject, `read`=GetObject→`transformToByteArray()`→Buffer, `getUrl`=S3_PUBLIC_URL หรือ `s3://bucket/key`; รองรับ AWS จริง (default credential chain) + MinIO (custom endpoint + path-style + explicit keys)
- `config/env.ts`: เพิ่ม S3_* config; validateEnv บังคับ `S3_BUCKET` เมื่อ driver=s3, และบังคับ keys เมื่อมี `S3_ENDPOINT` (custom endpoint ไม่มี IAM chain)
- `docker-compose.s3.yml` (ใหม่, override): MinIO + `minio-init` (mc one-shot สร้าง bucket, retry จน minio ขึ้น) + override api env เป็น s3 ชี้ MinIO; base stack ยังใช้ LocalStorage เหมือนเดิม
- `.env.example`: เอกสาร S3 vars

**ไฟล์หลัก** — `backend/src/shared/storage.ts`, `backend/src/config/env.ts`, `docker-compose.s3.yml`, `backend/.env.example`, `backend/package.json` (+`@aws-sdk/client-s3`)

**Verify** — typecheck (be) clean; **e2e จริงกับ MinIO**: `docker compose -f docker-compose.yml -f docker-compose.s3.yml up` → api healthy (env s3), login → upload CSV (201) → object โผล่ใน MinIO bucket (22B) → authed download **byte-match=True**; cleanup: ลบ S3 objects + attachment DB rows (2) + revert stack กลับ local storage

**ค้าง P3** — log aggregator (pino JSON พร้อม เหลือ wire ปลายทางจริง — deployment-specific)

---

## 2026-07-16 · P3 — Secret management / fail-fast env (/senior-fullstack)

**ทำ** (user: build secret management ต่อ)
- `validateEnv()` ใน `config/env.ts` รันตอน boot (ก่อน `app.listen`): DATABASE_URL บังคับทุก env; **prod** บังคับ JWT_ACCESS/REFRESH_SECRET ตั้งเอง (ไม่ใช่ dev-default), ≥32 ตัว, access≠refresh; ถ้า COOKIE_SECURE=false ใน prod → เตือน (warning ไม่ fatal); error log **ไม่โชว์ค่า secret** โชว์แค่ชื่อ var
- ยก dev-default เป็น const (`DEV_DEFAULT_ACCESS_SECRET`/`REFRESH`) reuse ทั้ง fallback + blocklist
- `server.ts`: try validateEnv → log warnings; ถ้า throw → `logger.fatal` + `process.exit(1)`
- **แก้ตามผลข้างเคียง**: compose รัน NODE_ENV=production → dev-default เดิมจะ fail-fast → เปลี่ยน compose secrets เป็น unique ≥32 ตัว (ไม่ใช่ fallback); `.env.example` เขียน requirement ชัด (`openssl rand -base64 48`)
- integration test รัน NODE_ENV=production แต่ import `createApp` (ไม่ใช่ server.ts) → validateEnv ไม่รัน → ไม่พัง

**ไฟล์หลัก** — `backend/src/config/env.ts` (+`validateEnv`), `backend/src/config/env.test.ts` (ใหม่, 7 tests), `backend/src/server.ts`, `docker-compose.yml`, `backend/.env.example`

**Verify** — typecheck (be) clean; `env.test.ts` 7/7 pass; **live**: prod + dev-default secret → **exit 1** + fatal log (ไม่รั่ว value); prod + strong secret → validate ผ่าน (โชว์ cookie warning) แล้วไป `app.listen`

**ค้าง P3** — S3Storage adapter (code ได้ แต่เทสต์เต็มต้องมี S3/MinIO), log aggregator

---

## 2026-07-15 · P3 — Health/readiness probes (/senior-fullstack)

**ทำ** (user: ทำ P3 → health/readiness probes)
- โมดูล `health`: `GET /api/v1/health` (liveness — process up, ไม่เช็ค dependency → DB ล่มไม่ทำให้ restart) + `GET /api/v1/ready` (readiness — `SELECT 1` ผ่าน prisma, 503 `not_ready` ถ้า DB ล่ม); repository ทำ ping (prisma เฉพาะ repo layer ตาม architecture)
- app.ts: แทน inline /health เดิมด้วย `healthRoutes` (public); แก้ comment เก่าที่ว่า kb public (ตอนนี้ behind auth)
- docker-compose: api มี `healthcheck` แบบ readiness-gated (ใช้ node global fetch เลี่ยง curl/wget), `web` `depends_on: api condition: service_healthy` → web สตาร์ตหลัง api healthy; CI e2e wait ใช้ `/ready`

**ไฟล์หลัก** — `backend/src/modules/health/{repository,controller,routes}.ts`, `backend/src/app.ts`, `docker-compose.yml`, `.github/workflows/ci.yml`

**Verify** — typecheck (be) / rebuild api+web; compose log แสดง api Waiting→Healthy ก่อน web start; `/health`=ok /ready=ready db=up; **หยุด postgres → /health ยัง 200, /ready 503; start postgres → /ready 200** (reconnect)

**ค้าง P3** — secret management (validate env fail-fast), S3Storage adapter, log aggregator

---

## 2026-07-14 · P2 — Playwright e2e (ปิด P2) (/senior-fullstack)

**ทำ** (user: ทำ P2 ด้วย Playwright)
- ติดตั้ง `@playwright/test` + chromium; `playwright.config.ts` (baseURL env `PLAYWRIGHT_BASE_URL`, default :3000, ไม่ auto webServer — รันกับ stack ที่เปิดอยู่)
- `frontend/e2e/` 7 specs: helpers.login; auth (guard redirect, login→shell); tickets (search→empty state, List/Board toggle, create-modal KB deflection สด); kb (browse→open article, filter by category)
- แก้ vitest `include: src/**/*.test.{ts,tsx}` กัน vitest/playwright เก็บ spec ของกันและกัน
- CI: job `e2e` — `docker compose up --build` → wait api/web health → `db:seed` → `playwright install --with-deps chromium` → `playwright test`; อัป HTML report เมื่อ fail; teardown `down -v`
- .gitignore เพิ่ม playwright-report/test-results

**ไฟล์หลัก** — `frontend/playwright.config.ts`, `frontend/e2e/*.spec.ts` + `helpers.ts`, `frontend/vitest.config.ts`, `frontend/package.json`, `.github/workflows/ci.yml`, `frontend/.gitignore`

**Verify** — `npx playwright test` → **7 passed** (local, docker stack); vitest ยัง 6 passed (ไม่เก็บ e2e); typecheck ผ่าน

**P2 เสร็จครบ** ✅ — เหลือ P3 (S3/health probes/secrets = Phase 7)

---

## 2026-07-14 · P2 — Reports เชิงลึก by-category / by-agent (/senior-fullstack)

**ทำ** (user: ต่อ P2 → reports เชิงลึก) — เพิ่ม breakdown ที่แท็บปลอมเดิมเคยหลอกว่ามี
- **Backend reports.repository:** terminal query select เพิ่ม category.name + assignee.name; คำนวณ
  - `byCategory` — SLA compliance ต่อหมวด (judged/met/breached/compliancePct) เรียงตามปริมาณ
  - `byAgent` — throughput ต่อเจ้าหน้าที่ (resolved count + avg resolution hours) เรียง busiest ก่อน
  - ทั้งคู่คำนวณจาก `terminal`/`judged` ที่ scoped อยู่แล้ว → เคารพ role อัตโนมัติ
- **Frontend:** schema เพิ่ม byCategory/byAgent; reports-body เพิ่ม 2 ตาราง (category = compliance bar เขียว; agent = avatar + resolved + avg); export.ts รวม 2 section ใน CSV; i18n `report.byCategory.*`/`report.byAgent.*`/cols

**ไฟล์หลัก** — `backend/src/modules/reports/reports.repository.ts`, `frontend/src/features/reports/{schemas.ts,export.ts,components/reports-body.tsx}`, `dictionary.ts`

**Verify** — typecheck (fe+be) / build; rebuild api+web; `/reports/sla-summary` คืน byCategory (Hardware 100%/judged1) + byAgent (Dana resolved1) scoped; web /reports 200

**ค้าง P2** — Playwright e2e (งานสุดท้ายของ P2)

---

## 2026-07-14 · P2 — row-scope dashboard/reports (/senior-fullstack)

**ทำ** (user: ต่อ P2 → row-scope) — dashboard/reports เดิม aggregate แบบ global (requester เห็นเลขรวมทั้งบริษัท ทั้งที่ ticket list เห็นแค่ของตัวเอง = ข้อมูลรั่ว/ไม่สอดคล้อง)
- แยก `scopeWhere` (private ใน ticket.repository) → shared **`ticketScopeWhere(user)`** ที่ `modules/tickets/ticket.scope.ts` (source of truth เดียว); ticket.repository ใช้ตัวนี้แทน
- dashboard.repository: `getSummary(now, user)` → AND scope เข้าทุก query (count/groupBy/active/resolved/closedThisWeek)
- reports.repository: `getSlaSummary(now, user)` → scope terminal tickets + ticketStatusHistory (ผ่าน relation filter `ticket: scope`)
- thread user ผ่าน service + controller (`req.user`) ทั้ง dashboard + reports
- ไม่แตะ frontend (API contract เดิม แค่ค่า scoped)

**ไฟล์หลัก** — `backend/src/modules/tickets/ticket.scope.ts` (ใหม่), `ticket.repository.ts`, `dashboard/{repository,service,controller}.ts`, `reports/{repository,service,controller}.ts`, CLAUDE.md

**Verify** — typecheck (be) / build; rebuild api; ทดสอบจริงเทียบ role: requester(marcus) dash.total=1 = tickets.list=1; agent(dana/ana) =8=8; report.resolved requester=0 agent=1 → **dash.total ตรงกับ ticket list ทุก role** (พิสูจน์ว่า scope สอดคล้องกัน)

**ค้าง P2** — Playwright e2e, reports เชิงลึก (by category/agent)

---

## 2026-07-14 · P1 — หน้า Settings จริง (/senior-fullstack)

**ทำ** (user: ทำ P1 หน้า Settings ต่อ) — เดิม `/settings` เป็น ComingSoon
- **Backend:** self-service `PATCH /users/me` `{name}` (any authenticated user แก้บัญชีตัวเอง, ไม่ต้อง `user:write`, audited `user.profile_update`); route ต้องมาก่อน `/:id`; repo `updateProfile` + service `updateProfile(actor)` + validator `updateProfileBody` (trim, 1–80)
- **Frontend:** `SettingsView` — Account (avatar + role badge + email read-only + **ชื่อแก้ได้** → save), Preferences (สลับภาษา EN/ไทย จริง), Session (Sign out); auth context เพิ่ม `patchUser()` อัปเดต user ใน memory ทันทีหลัง save; api `updateMyProfile` + envelope; i18n `settings.*`
- เน้น "ไม่มีปุ่มปลอม" — โชว์เฉพาะสิ่งที่ backend รองรับจริง (role/team read-only เพราะ admin จัดการ)

**ไฟล์หลัก** — `backend/src/modules/users/{user.routes,user.controller,user.service,user.repository,user.validators}.ts`, `frontend/src/features/settings/settings-view.tsx`, `frontend/src/features/auth/context.tsx`, `frontend/src/features/users/{api.ts,schemas.ts}`, `frontend/src/app/(app)/settings/page.tsx`, `dictionary.ts`

**Verify** — typecheck (fe+be) / build ผ่าน; rebuild api+web; ทดสอบจริง: rename→"Dana R." ok, empty name→400, no-auth→401, revert→Dana Reyes; web /settings 200

---

## 2026-07-14 · P1 — Bulk ticket actions (/senior-fullstack)

**ทำ** (user: ทำ P1 → เลือก Bulk actions) — toolbar เลือกหลายตั๋วเดิมปลอม
- **Backend:** เพิ่ม 2 endpoint (perm `ticket:write`, scoped ผ่าน get()→404, audited)
  - `PATCH /tickets/:id/assignee` `{assigneeId|null}` — validate assignee, notify requester+assignee (ยกเว้น actor)
  - `PATCH /tickets/:id/priority` `{priority}` — re-derive `dueAt` = computeDueAt(priority, createdAt) ให้ SLA ยังถูก
  - repository `updateAssignee`/`updatePriority` ($transaction + audit + notify); service `changeAssignee`/`changePriority`; validators `updateAssigneeBody`/`updatePriorityBody`
- **Frontend:** api `updateTicketAssignee`/`updateTicketPriority` + hook `useBulkTicketAction` (fan-out Promise.allSettled → นับ failed, invalidate); `BulkActionBar` (Assign/Status/Priority dropdown menus, ดึง users สำหรับ assign, โชว์ "N updated · M failed" ถ้ามี fail เช่น illegal transition); แทน spans ปลอมใน ticket-table; i18n `bulk.*`
- fan-out design: แต่ละตั๋ว patch แยก → ตัวที่ fail (409 transition) ไม่ล้มทั้ง batch

**ไฟล์หลัก** — `backend/src/modules/tickets/{ticket.routes,ticket.controller,ticket.service,ticket.repository,ticket.validators}.ts`, `frontend/src/features/tickets/{api.ts,queries.ts,components/bulk-action-bar.tsx,components/ticket-table.tsx}`, `dictionary.ts`

**Verify** — typecheck (fe+be) / build ผ่าน; rebuild api+web; ทดสอบจริง: assign→Ana M. ok, priority→critical ok, invalid priority→400, unknown assignee→400; revert demo data (1042 priority→high, 1039 assignee→Dana Reyes); web /tickets 200

**ค้าง P1** — หน้า Settings (ยัง placeholder)

---

## 2026-07-14 · หน้า KB จริง (/senior-fullstack)

**ทำ** (user: ทำหน้า KB จริงต่อ) — เดิม `/kb` เป็น ComingSoon; backend มีแค่ `/suggest` hardcode 3 อัน
- **Backend `kb` module:** `kb.data.ts` (6 บทความจริง: id/title/category/tags/readMin/updatedAt/excerpt/body markdown-lite) + service (list กรอง q/category, categories, get→404, suggest top-3) + controller (zod) + routes (`/`, `/suggest`, `/:id` — เรียง suggest ก่อน :id); ใส่ `requireAuth` ให้ /kb เหมือน module อื่น
- **Frontend feature `kb`:** schemas(zod) + api + queries(useKbArticles/useKbArticle/useKbSuggest) + `KbBrowser` (search + category chips + cards) + `KbArticleView` + `render.tsx` (KbBody parser: ## heading / - bullet / paragraph); pages `/kb` + `/kb/[id]`
- **Create modal deflection:** เดิม SUGGESTED hardcode → ต่อ `useKbSuggest(subject)` สด, แต่ละอัน Link ไป `/kb/{id}` (target=_blank ไม่เสีย draft)
- i18n `kb.*` (TH/EN)

**ไฟล์หลัก** — `backend/src/modules/kb/{kb.data,kb.service,kb.controller,kb.routes}.ts`, `backend/src/app.ts`, `frontend/src/features/kb/*`, `frontend/src/app/(app)/kb/{page,[id]/page}.tsx`, `create-ticket-modal.tsx`, `dictionary.ts`

**Verify** — typecheck (fe+be) / build ผ่าน; rebuild api+web; endpoint ทดสอบครบ: list=6+6cats, ?category=Network→KB-118, ?q=password→KB-042/017, /KB-118 body ok, /suggest?q=vpn→KB-118, /NOPE→404, no-auth→401; web /kb + /kb/KB-042 = 200

---

## 2026-07-14 · P0 fix — ไฟล์แนบ persistent (named volume)

**ทำ** (audit /senior-fullstack เจอ: api ไม่มี volume → ไฟล์แนบหายตอน rebuild)
- `docker-compose.yml`: api mount named volume `deskly-uploads:/data/uploads` + env `LOCAL_STORAGE_DIR=/data/uploads` (เดิม default `./.uploads` อยู่ใน ephemeral fs ของ container)
- ทดสอบจริง: upload → ไฟล์ลง `/data/uploads/tickets/1039/...csv` → `docker compose up --force-recreate api` → ไฟล์ยังอยู่ + download HTTP 200 (เดิมหาย 404)

**ไฟล์หลัก** — `docker-compose.yml`

**Verify** — upload/recreate/download round-trip ผ่าน; ลบไฟล์ทดสอบ (id 7) ออกแล้ว

**ค้างต่อ** (จาก audit) — P1 bulk actions, หน้า KB จริง, Settings; P2 row-scope dashboard/reports, Playwright e2e; P3 S3Storage + health probes + secrets (Phase 7)

---

## 2026-07-13 · ปรับปรุงหน้า ticket (list + detail) (/senior-fullstack)

**ทำ** (user: ปรับปรุงหน้า ticket — ทั้งสองหน้า) — audit เจอ dead controls เพียบ แก้ทั้งชุด
- **List:** filter chips เดิมปลอมทั้งหมด → ทำ filter จริง: Status/Priority (multi-select dropdown) + "Assigned to me" toggle, กรอง List และ Board สด (รวมกับ search + sort header เดิม), ปุ่ม Clear + badge นับ filter ที่ active
  - ขยาย `search-context` เก็บ statuses/priorities/assigneeMe + `matchesFilters(ticket, filters, meName)`
  - footer เดิม pager ปลอม `‹ 1 ›` → แสดงจำนวนจริง "X จาก Y (กรองแล้ว)"
- **Detail:** SLA badge หัวเรื่องเดิม fix สีเหลืองตายตัว → สีตาม slaState (แดง=breach, จาง=met/paused); ปุ่ม "⋯" ตาย → ลบ; ปุ่ม "Attach" ใน composer ตาย → แนบไฟล์ได้จริง (useUploadAttachment → panel refresh)
- i18n เพิ่ม filter.* / detail.* / composer.* (TH/EN)

**ไฟล์หลัก** — `frontend/src/features/tickets/{search-context.tsx,components/filter-bar.tsx,components/ticket-table.tsx,components/ticket-board.tsx,components/ticket-list-footer.tsx,components/ticket-detail-view.tsx,components/composer.tsx}`, `frontend/src/features/i18n/dictionary.ts`

**Verify** — typecheck / build ผ่าน; rebuild web → `/tickets` + `/tickets/1042` 200

**ค้าง** — bulk-action bar ในตาราง ("Assign ▾/Status ▾/Priority ▾") ยังปลอม (มีแต่ status endpoint; assign/priority ต้องเพิ่ม endpoint) — ยังไม่แตะรอบนี้

---

## 2026-07-13 · ปรับปรุงหน้า Report ใหม่ (/senior-fullstack)

**ทำ** (user: ปรับปรุงหน้า Report ใหม่) — audit แล้วเจอปัญหา แก้ทั้งชุด
- 🐛 **กราฟ trend พัง**: เดิมเอา count (0–5) ไปเป็นพิกัด y บน viewBox ตรงๆ → เส้นกระจุกขอบบน; แก้เป็น scale ตาม max จริง (buildChart) + จุดทุกวัน
- ❌ **ชื่อ/label ผิด**: เดิม "Avg resolution time by week · hours" + 5 สัปดาห์ hardcode แต่ data คือ "ตั๋วแก้ไข/วัน 7 จุด" → เปลี่ยนชื่อให้ตรง + label วันคำนวณจากวันจริง (`trendDayLabels`)
- ❌ **delta ปลอม** (`▼ 1.1 h` ฯลฯ) → ตัดออก, ใส่ caption จริงจาก 2 field ใหม่ `resolvedCount`/`judgedCount` (เสริมใน backend reports.repository)
- ✅ **Export CSV ใช้ได้จริง**: `export.ts` (reportsToCsv + downloadCsv + BOM สำหรับ Excel/ไทย) + `ReportActions` client component ต่อปุ่ม
- เพิ่มแถวรวม "All priorities" ในตาราง SLA; ลบแท็บ 5 อันที่กดไม่ได้ (`report-tabs.tsx`) + date-range dropdown ปลอมออก
- i18n ครบทั้งหน้า (report.* keys TH/EN)

**ไฟล์หลัก** — `backend/src/modules/reports/reports.repository.ts`,
`frontend/src/features/reports/{schemas.ts,export.ts,components/reports-body.tsx,components/report-actions.tsx}`,
`frontend/src/app/(app)/reports/page.tsx`, `frontend/src/features/i18n/dictionary.ts` (ลบ `report-tabs.tsx`)

**Verify** — typecheck (fe+be) / build ผ่าน; rebuild web+api; `GET /reports/sla-summary` มี resolvedCount/judgedCount, trend 7 จุด scale ถูก; `/reports` 200

---

## 2026-07-13 · ปรับ — ปุ่ม Mark resolved สีน้ำตาลอ่อน + ปุ่มดูไฟล์ (eye) ชัดขึ้น

**ทำ** (user: ปุ่ม Resolved เป็นน้ำตาลอ่อน; เพิ่มปุ่มกดดูไฟล์แนบ)
- ปุ่ม "Mark resolved" (ticket-detail): จากเทา outline → พื้นน้ำตาลอ่อน `#efe0cd` / border `#e2caa5` / ตัวอักษร brand-hover, hover `#e7d3b8`
- attachments-panel: เพิ่มปุ่มไอคอน **ตา (Eye) = ดูไฟล์** ต่อแถว ให้ชัดว่ากดดูได้ (นอกจากคลิกชื่อไฟล์) คู่กับปุ่ม download เดิม

**ไฟล์หลัก** — `frontend/src/features/tickets/components/ticket-detail-view.tsx`,
`frontend/src/features/attachments/attachments-panel.tsx`

**Verify** — typecheck / build ผ่าน; rebuild web → `/tickets/1039` 200

---

## 2026-07-13 · เพิ่ม — แนบไฟล์ตอนสร้าง ticket + กดดูไฟล์แนบได้

**ทำ** (user: หน้า new ticket แนบได้ทั้งรูปและไฟล์ data PDF/Excel/CSV; หน้า ticket ที่มีไฟล์แนบกดดูได้)
- create-ticket modal: drop zone เดิมเป็น div ตาย → ทำเป็น uploader จริง (คลิก browse / ลากวาง, หลายไฟล์, โชว์ชื่อ+ขนาด+ปุ่มลบ); `accept` = images + PDF/Excel(.xls/.xlsx)/CSV; หลัง create สำเร็จ upload แนบเข้า ticket ทีละไฟล์ (best-effort, ถ้าพลาดแจ้งว่าไฟล์ไหนแนบไม่ได้ แต่ ticket ถูกสร้างแล้ว)
- backend allowlist มี image/pdf/csv/xls/xlsx/doc/docx/zip อยู่แล้ว (25 MB) → ไม่ต้องแก้
- ดูไฟล์: `viewAttachment()` ใหม่ — เปิดแท็บใหม่ (เปิดแท็บก่อน sync กัน popup blocker) แล้ว fetch blob พร้อม bearer token → รูป/PDF preview inline; ประเภทอื่น fallback เป็น download
- backend download รับ `?disposition=inline` → ตั้ง `Content-Disposition: inline` (default ยังเป็น attachment)
- attachments-panel: คลิกชื่อไฟล์ = ดู, มีปุ่ม download แยกต่อแถว

**ไฟล์หลัก** — `frontend/src/features/tickets/components/create-ticket-modal.tsx`,
`frontend/src/features/attachments/{api.ts,attachments-panel.tsx}`,
`backend/src/modules/attachments/attachment.controller.ts`

**Verify** — typecheck (fe+be) / build ผ่าน; rebuild web+api; e2e จริง: upload `report.csv` → inline `Content-Disposition: inline`, default `attachment` ✓

---

## 2026-07-13 · เพิ่ม — header ticket-list กดจัดเรียง (sort) ได้

**ทำ** (user: อยากได้ปุ่มฟิลเตอร์เล็กๆ ที่ header เพื่อจัดกลุ่ม เช่น priority เรียงจาก critical)
- เปลี่ยน header ทุกคอลัมน์เป็นปุ่มกดจัดเรียง (`SortHeader`) พร้อม caret บอกทิศ; กดสลับ asc/desc, inactive โชว์ไอคอน ⇅ จางตอน hover
- จัดเรียงแบบเข้าใจ domain ไม่ใช่เรียงตามตัวอักษร:
  - **Priority** → Critical → High → Medium → Low (`PRIORITY_ORDER`)
  - **Status** → ตาม lifecycle `new → … → closed` (`STATUS_ORDER`)
  - **SLA due** → ตามเวลาที่เหลือจริง (parse "Xd Yh Zm"); เกินกำหนดขึ้นก่อน, paused/met ไปท้าย
  - id (ตัวเลข), subject/assignee/category (localeCompare, assignee ว่างไปท้าย)
- กรอง (search) + เรียง รวมใน `useMemo` เดียว

**ไฟล์หลัก** — `src/features/tickets/components/ticket-table.tsx`

**Verify** — typecheck / build ผ่าน; rebuild web → `GET /tickets` 200

---

## 2026-07-13 · Fix — search boxes ใช้งานได้จริง (typing + กรอง)

**ทำ** (user: "ช่อง search ไม่สามารถ typing ได้")
- ทั้ง topbar search และ filter-bar search เดิมเป็น markup ตาย (`<button>` / `<div>`) พิมพ์ไม่ได้
- สร้าง `search-context.tsx` — `SearchProvider` + `useSearch()` (query ร่วมกัน) + `matchesQuery()` (subject / `#id` / requester)
- topbar + filter-bar → เปลี่ยนเป็น `<input>` จริง bind กับ `query`/`setQuery`; topbar Enter → เด้งไป `/tickets`
- ต่อสายกรองจริงใน `ticket-table.tsx` และ `ticket-board.tsx` (กรอง rows/tickets ด้วย `matchesQuery` ก่อน render) → พิมพ์แล้วกรองสดทั้ง List และ Board
- เพิ่ม dict key `filter.search` (en/th) เป็น placeholder

**ไฟล์หลัก** — `src/features/tickets/search-context.tsx` (ใหม่), `src/app/(app)/layout.tsx` (wrap `SearchProvider`),
`src/components/layout/topbar.tsx`, `src/features/tickets/components/{filter-bar,ticket-table,ticket-board}.tsx`,
`src/features/i18n/dictionary.ts`

**Verify** — typecheck / build ผ่าน; rebuild web → `GET /tickets` 200, ช่อง search พิมพ์ได้และกรองสด

---

## 2026-07-13 · Rebrand — brown / cream / green theme

**ทำ** (ตามที่ user เลือก: น้ำตาล primary · ครีม พื้นหลัง · เขียว accent)
- tokens: `brand` → น้ำตาล `#7d5329`/hover `#5f3f1f`, `app` → ครีม `#f6efe1`, เพิ่ม `accent` เขียว `#3f8f5e`/soft `#e4f2ea`; `globals.css` `--app-bg` ครีม
- swap theme-blue inline → เขียว (active/selected tint) / น้ำตาล (brand): sidebar (active nav/badge/saved-view), filter-bar (chips), ticket-table & notifications & my-tickets (selected/unread/hover), create-ticket modal (KB box/code/priority active), login hero gradient (เขียว), reports chart line/area (น้ำตาล)
- **ไม่แตะ** สี semantic: status palette (New=น้ำเงินคงเดิม ฯลฯ), priority dots, avatar tones

**ไฟล์หลัก** — `tailwind.config.ts`, `src/app/globals.css`, `src/components/layout/sidebar.tsx`, `src/app/login/page.tsx`,
`src/features/tickets/components/{filter-bar,ticket-table,create-ticket-modal}.tsx`, `src/components/layout/notifications-bell.tsx`,
`src/features/dashboard/components/my-tickets.tsx`, `src/features/reports/components/reports-body.tsx`

**Verify** — typecheck / 6 tests / build ผ่าน; rebuild web → ธีมใหม่ live

**ปรับเพิ่ม** — ลองสลับ active/selected highlight เป็นโทนน้ำตาล (tan) แล้ว **เปลี่ยนกลับเป็นเขียว** ตามที่ user ขอ
(สรุป: active/selected = เขียว `#e4f2ea`, primary = น้ำตาล, พื้น = ครีม) — typecheck/build ผ่าน, rebuild web แล้ว

---

## 2026-07-13 · Fix/Feature — tickets List/Board toggle + kanban board

**ทำ** — ปุ่ม List/Board เดิมเป็น `<span>` กดไม่ได้ (placeholder) → ทำหน้า tickets เป็น client + `view` state;
ปุ่มจริง (แปล List/บอร์ด); `TicketBoard` (kanban) จัดกลุ่มตั๋วตามสถานะเป็นคอลัมน์ + การ์ด (id/subject/priority/assignee/SLA) กดเข้า ticket detail

**ไฟล์หลัก** — `src/app/(app)/tickets/page.tsx` (client + toggle), `src/features/tickets/components/ticket-board.tsx` (ใหม่),
`src/features/i18n/dictionary.ts` (tickets.list/board)

**Verify** — typecheck / `next build` ผ่าน; rebuild web → `/tickets` 200; สลับ List ⇄ Board ได้จริง

---

## 2026-07-13 · Feature — i18n (TH/EN) language switch

**ทำ**
- foundation (ไม่เพิ่ม dep): `features/i18n/dictionary.ts` (en/th) + `LanguageProvider` (context, persist localStorage แบบ guard) +
  `useI18n().t` (รองรับ interpolation `{n}`) + `LanguageToggle` (topbar + login); wrap ใน `providers.tsx`
- แปล surface หลัก: sidebar, topbar (+`titleKey`), notifications bell, status/priority (StatusBadge/PriorityIndicator + charts),
  common states, ComingSoon, login (เต็ม), dashboard (greeting + วันที่ localized, stat-cards, charts, my-tickets),
  ชื่อหน้า (tickets/reports/users/kb/settings), ticket-table headers
- test: เพิ่ม `src/test-utils.tsx` (render ครอบ LanguageProvider ผ่าน `wrapper` option); guard `window.localStorage` (jsdom/SSR/private mode)

**ไฟล์หลัก** — `src/features/i18n/*`, `src/components/layout/{language-toggle,sidebar,topbar,notifications-bell,coming-soon}.tsx`,
`src/components/ui/{status-badge,states}.tsx`, `src/app/login/page.tsx`, `src/features/dashboard/components/*`,
`src/features/tickets/components/ticket-table.tsx`, page title props, `src/test-utils.tsx`, `src/app/providers.tsx`

**Verify** — typecheck / lint (clean) / 6 frontend tests / `next build` ผ่าน; rebuild web → live stack มีปุ่ม EN/ไทย (จำค่าใน localStorage)

**ค้าง** — string ลึกยังเป็น EN: create-ticket modal, filter bar, ticket-detail composer/thread labels, reports body, bulk bar — เติม key ใน dictionary เพิ่มได้

---

## 2026-07-13 · Feature — ticket status-history endpoint + timeline

**ทำ**
- `GET /tickets/:id/history` — `ticketRepository.findHistory` (join changedBy, ordered newest-first) →
  `ticketService.history(id, user)` (authorize ผ่าน row scope) → controller/route
- FE: `historyEntrySchema` + `fetchTicketHistory` + `useTicketHistory` (key `tickets/history/:id`, invalidate ตาม `ticketKeys.all` ตอนเปลี่ยน status);
  `HistoryPanel` client component; นำ Section "History" กลับเข้า properties rail (ข้อมูลจริง แทน hardcode ที่เคยถอด)

**ไฟล์หลัก** — `src/modules/tickets/{ticket.repository,ticket.service,ticket.controller,ticket.routes}.ts`,
`frontend/src/features/tickets/{schemas,api,queries}.ts`, `frontend/src/features/tickets/components/{history-panel,properties-rail}.tsx`

**Verify**
- typecheck BE+FE ผ่าน; integration **31** (+2: timeline appends on change / out-of-scope 404); `next build` ผ่าน; รวม **58 tests**
- rebuild full stack → live: GET /tickets/1042/history = 1 entry (creation, in_progress by Dana)

---

## 2026-07-13 · Domain rules — reopen 30-day guard + 72h auto-close

**ทำ**
- **reopen ≤ 30 วัน**: เพิ่ม `ReopenWindowExpired` (409 `REOPEN_WINDOW_EXPIRED`); expose `closedAt` ใน Ticket DTO (+FE schema);
  guard ใน `ticket.service.changeStatus` เมื่อ `closed → open` และ `now − closedAt > 30d` → 409
- **auto-close 72 ชม.**: `ticketRepository.findStaleResolved(cutoff)` + `ticketService.autoCloseStale(now)` →
  `updateStatus(id, "closed")` (reuse history/audit/notification, actor = system/null); scheduler ใน `server.ts`
  (บูต + ทุกชั่วโมง, `setInterval().unref()`, env `AUTO_CLOSE` default on) — อยู่ใน server.ts จึงไม่ทำงานตอน test

**ไฟล์หลัก** — `src/shared/errors.ts`, `src/modules/tickets/{ticket.repository,ticket.service}.ts`,
`src/config/env.ts`, `src/server.ts`, `frontend/src/features/tickets/schemas.ts`, `test/app.integration.test.ts`

**Verify**
- typecheck BE+FE ผ่าน; unit 21; integration **29** (+4: reopen allow/reject, auto-close close/skip); รวม **56 tests**
- rebuild compose `api` → live stack มี guard + scheduler (boot sweep = 0 stale, ไม่ crash)

---

## 2026-07-13 · Feature — dashboard & reports computed from DB

**ทำ**
- แทน route static เดิมด้วย vertical slice จริง: `dashboard` + `reports` (repository/service/controller/routes)
- **dashboard/summary** (Prisma aggregate): totalTickets, openTickets (active), unassigned, closedThisWeek,
  avgResolutionHours (resolvedAt−createdAt), slaAtRisk (dueAt ≤ +4h), slaBreachUnder1h, byStatus (groupBy), openByPriority
- **reports/sla-summary**: avgResolutionHours, slaCompliancePct (resolvedAt ≤ dueAt), byPriority met/breached,
  resolutionTrend (7 วันย้อนหลัง), medianFirstResponseMin (จาก first status transition; seed = 0)
- คง response shape ตรง FE zod เป๊ะ

**ไฟล์หลัก** — `src/modules/dashboard/*`, `src/modules/reports/*` (routes เดิมถูกแทน)

**Verify**
- typecheck ผ่าน; runtime เทียบ seed: total 8, open 7, unassigned 1, byStatus new1/open2/in_progress2/pending2/resolved1,
  compliance 100% (1031 met), trend [..,1] — ตรงหมด
- พิสูจน์สด: resolve #1035 → open 7→6, resolved 1→2, medium byPriority met1 (recompute per request)
- rebuild+recreate compose `api` → stack ที่ localhost:4000 เสิร์ฟค่า computed แล้ว (8/7 ไม่ใช่ static 1284/86)

**หมายเหตุ** — aggregate เป็น **global** (ยังไม่ scope ตาม user); เป็น refinement ในอนาคต

---

## 2026-07-13 · Tests — P1 integration coverage (auth refresh, users, notifications, attachments)

**ทำ** — เติม integration tests (supertest) ปิดช่อง P1 จาก QA report:
- **auth**: refresh rotate + reuse-detection (revoke family) + no-cookie 401 + logout→refresh 401
- **users**: staff อ่าน directory / requester 403 / เฉพาะ admin แก้ role ได้ (โปรโมต user เป็น admin ในเทสต์)
- **notifications**: status change → requester ได้ noti, actor ไม่ได้; mark read → unread 0
- **attachments**: multipart upload → list → authed download (เทียบ bytes) + content-type ต้องห้าม → 400
- เพิ่ม helper `refreshCookie()` ดึง `deskly_rt` จาก Set-Cookie

**ไฟล์หลัก** — `backend/test/app.integration.test.ts`

**Verify** — typecheck ผ่าน; integration **25 ผ่าน** (จาก 17); รวมทั้งโปรเจกต์ **52 tests** (21 unit + 25 integration + 6 frontend); ล้างไฟล์ `.uploads` ที่เทสต์อัปโหลด

---

## 2026-07-13 · Verify — full-stack `docker compose up` (smoke test)

**ทำ** — `docker compose up -d --build` บูตทั้งสแตก (postgres + api + web) จริงเป็นครั้งแรก
(reclaim port 4000 จาก process node ค้างเก่า PID 42916 ก่อน)

**Verify (HTTP เลียนแบบ browser)**
- api health `env=production`; api รัน `prisma migrate deploy` ตอนบูต (no pending); web `/login` → 200
- login → 200, **Set-Cookie ไม่มี `Secure`** (compose HTTP) + client เก็บ cookie ได้
- **refresh roundtrip → 200 + rotate** (ยืนยัน COOKIE_SECURE fix ทำให้ session อยู่รอดบน HTTP)
- GET /tickets → 200 total=7 (api↔postgres ใน container, ข้อมูล seed); logout → 200

**หมายเหตุ** — สแตกเปิดค้างไว้ที่ http://localhost:3000 (login: `dana.reyes@acme.com` / `password123`); หยุดด้วย `docker compose down` (ข้อมูลใน volume ไม่หาย)

---

## 2026-07-13 · Hardening (#6 จาก QA report)

**ทำ**
- rate-limit `POST /auth/login` ต่อ IP (`express-rate-limit`, `AUTH_RATE_LIMIT` default 20/15นาที → 429)
- `express.json({ limit: "1mb" })`; multer `fileFilter` allowlist content-type (นอกเหนือ 25MB cap) → reject = 400
- `authRepository.deleteExpired(userId)` เรียกตอน login (prune refresh token หมดอายุ; ไม่แตะ revoked-but-unexpired เพื่อคง reuse-detection)
- errorHandler รองรับ error ที่มี HTTP status (body-parser): oversized → **413**, malformed JSON → **400** (เดิม 500 ทั้งคู่)
- integration test: login อีเมลไม่มีในระบบ → 401 (ไม่ 500); integration config ตั้ง `AUTH_RATE_LIMIT=1000` กัน suite ทริป limiter

**ไฟล์หลัก** — `src/config/env.ts`, `src/app.ts`, `src/middlewares/index.ts`,
`src/modules/auth/{auth.routes,auth.repository,auth.service}.ts`, `src/modules/attachments/attachment.routes.ts`,
`backend/.env.example`, `vitest.integration.config.ts`, `test/app.integration.test.ts`

**Verify**
- typecheck ผ่าน; unit **21**, integration **17** (+enumeration) ผ่าน; build ผ่าน
- runtime (AUTH_RATE_LIMIT=3): upload octet-stream → 400, text → 201; oversized body → 413; malformed JSON → 400; login เกินลิมิต → 429

**คงไว้ (ตั้งใจ)** — access token เพิกถอนก่อนหมดอายุตอน logout ไม่ได้ (JWT trade-off, TTL 15 นาที)

---

## 2026-07-13 · Fix — general unassigned queue (#5 จาก QA report)

**ทำ**
- `scopeWhere` (agent + manager) เพิ่ม OR clause: `{ assigneeId: null, category: { defaultTeamId: null } }`
  → ตั๋ว unassigned ที่หมวดไม่มีทีม route จะเข้า **คิวกลาง** เห็นได้ทุก agent/manager (เดิมล่องหน เห็นแค่ requester+admin)
- integration test ใหม่: สร้าง category `defaultTeamId=null` + ตั๋ว unassigned → agent สองทีมเห็น, requester ที่ไม่เกี่ยวไม่เห็น

**ไฟล์หลัก** — `src/modules/tickets/ticket.repository.ts`, `test/app.integration.test.ts`

**Verify** — typecheck ผ่าน; unit **21**, integration **16** (+1) ผ่าน; team-scoping เดิมไม่ regress

---

## 2026-07-13 · Fix — real SLA met/breached (#4 จาก QA report)

**ทำ**
- เพิ่ม `Ticket.resolvedAt` (`resolved_at`, migration); เซ็ตตอน transition → `resolved` ใน `updateStatus`
- `deriveSla(status, dueAt, now, resolvedAt)` — resolved/closed: `resolvedAt <= dueAt` → **met**, ไม่งั้น **breached** (slaState danger); fallback met ถ้าไม่มี target/timestamp
- seed เซ็ต `resolvedAt` ให้ตั๋ว resolved/closed (met); อัปเดต unit tests (breached + fallback)

**ไฟล์หลัก** — `prisma/schema.prisma` (+`resolved_at`), `src/modules/tickets/{sla,ticket.repository}.ts`, `prisma/seed-fn.ts`, `src/modules/tickets/sla.test.ts`

**Verify**
- typecheck ผ่าน; unit tests **21 ผ่าน** (+2 breached/fallback)
- runtime: #1031 resolved ตรงเวลา → `met`; หลังบังคับ `due_at < resolved_at` → `breached`/danger ✅; reseed คืนค่า

**ค้าง** — `/reports` compliance ยัง static (คนละ item — dashboard/reports ต้อง compute จาก DB)

---

## 2026-07-11 · Fix — cookie Secure flag over HTTP (#2 จาก QA report)

**ทำ**
- decouple `secure` ของ refresh cookie ออกจาก `NODE_ENV` → `env.cookieSecure` (อ่าน `COOKIE_SECURE`, default = `nodeEnv==="production"`)
- ใช้ `env.cookieSecure` ใน `auth.controller`; docker-compose api ตั้ง `COOKIE_SECURE=false` (สแตกเสิร์ฟ HTTP); เอกสารใน `.env.example`

**ไฟล์หลัก** — `backend/src/config/env.ts`, `backend/src/modules/auth/auth.controller.ts`, `docker-compose.yml`, `backend/.env.example`

**Verify (runtime)**
- production + `COOKIE_SECURE=false` → `Set-Cookie` = `HttpOnly; SameSite=Lax` (ไม่มี `Secure`) → browser เก็บ cookie ได้บน HTTP
- production default (ไม่ตั้ง `COOKIE_SECURE`) → มี `Secure` → prod หลัง TLS ยังปลอดภัย

**หมายเหตุ** — cross-site deploy จริง (คนละ domain web/api) ต้องใช้ `SameSite=None; Secure` เพิ่ม; ตอนนี้ lax พอสำหรับ same-site (subdomain/ports เดียวกัน)

---

## 2026-07-11 · Fix — frontend blind spots (#1, #3 จาก QA report)

**ทำ**
- **#1** MyTickets + dashboard greeting ใช้ user จาก session (`useAuth`) แทน hardcode "Dana Reyes"/วันที่;
  เพิ่ม `DashboardGreeting` (ทักทายตามช่วงเวลา + วันที่จริง + ชื่อจริง)
- **#3** properties-rail: Category + SLA (due/state) เป็นข้อมูลจริง; ลบส่วนที่ hardcode แต่ไม่มี backing data
  (Department, Linked KB, first-response, SLA bar %, History timeline)

**ไฟล์หลัก**
- `features/dashboard/components/{greeting,my-tickets}.tsx`, `app/(app)/dashboard/page.tsx`,
  `features/tickets/components/properties-rail.tsx`

**Verify** — typecheck / 6 frontend tests / `next build` (11 routes) ผ่าน

**ค้าง** — History section จริง ต้องมี endpoint `GET /tickets/:id/history` (จาก `ticket_status_history`) — ยังไม่ทำ

---

## 2026-07-10 · Security — bump Next.js (CVE) + ESLint config

**ทำ**
- bump `next` + `eslint-config-next` `15.1.6 → 15.5.20` (สาย 15.x ล่าสุด / `backport` tag) — แก้ **CVE-2025-66478** (dev-server origin exposure) + Next advisories อื่น ๆ; critical หายจาก `npm audit`
- เพิ่ม `frontend/.eslintrc.json` (`next/core-web-vitals`) — เดิมไม่มี config ทำให้ `next lint` prompt แบบ interactive (จะค้างใน CI); ตอนนี้ lint รันจริง ผ่านสะอาด

**ไฟล์หลัก** — `frontend/package.json` (+ lockfile), `frontend/.eslintrc.json`

**Verify**
- `npm audit`: critical หมดแล้ว (เหลือ 2 moderate = postcss ที่ Next bundle มาเอง, build-time; `audit fix --force` จะ downgrade next→v9 จึงไม่ทำ — รออัปสตรีม)
- typecheck / lint (clean) / test (6 ผ่าน) / build ผ่าน; rebuild image `helpdesk-web` ผ่าน

**ค้าง** — 2 moderate (Next bundled postcss) รออัปสตรีม; Playwright e2e

---

## 2026-07-10 · Phase 6 — Docker & CI/CD

**ทำ**
- multi-stage Dockerfiles:
  - `backend/Dockerfile` — build (npm ci → `prisma generate` → tsc) → runtime (node_modules+dist+prisma, CMD = `prisma migrate deploy && node dist/server.js`)
  - `frontend/Dockerfile` — Next `output:"standalone"` → runtime `node server.js` (+ copy `.next/static`)
  - `.dockerignore` ทั้งคู่; เพิ่ม `output:"standalone"` ใน `next.config.mjs`
- ขยาย `docker-compose.yml` เป็น full stack: postgres + api (build ./backend, DATABASE_URL→service `postgres`, depends_on healthy) + web (build ./frontend, arg `NEXT_PUBLIC_API_URL`)
- GitHub Actions `.github/workflows/ci.yml`: job **backend** (postgres service → npm ci, prisma generate, typecheck, `npm test`, `npm run test:integration`, build) + job **frontend** (npm ci, typecheck, lint, test, build)

**ไฟล์หลัก**
- `backend/{Dockerfile,.dockerignore}`, `frontend/{Dockerfile,.dockerignore}`, `frontend/next.config.mjs`,
  `docker-compose.yml`, `.github/workflows/ci.yml`

**Verify**
- `docker compose config` valid; `docker compose build api` + `build web` → **build สำเร็จทั้งคู่** (`helpdesk-api`, `helpdesk-web`)
- frontend standalone: `.next/standalone/server.js` + `.next/static` มีจริง
- ในคอนเทนเนอร์ npm ci รัน postinstall ปกติ (prisma generate ผ่าน) — ยืนยัน allow-scripts block เป็นของ host เท่านั้น

**หมายเหตุ/ค้าง**
- ⚠️ Next 15.1.6 มี advisory **CVE-2025-66478** — ควร bump เป็น patched 15.x (คือ critical vuln ที่ npm รายงาน)
- ยังไม่รัน full stack `docker compose up` (เลี่ยงรบกวน postgres dev ที่รันอยู่); Playwright e2e ใน CI → Phase 7-ish

---

## 2026-07-10 · Phase 5 (slice 3, จบ Phase) — Frontend component tests

**ทำ**
- ตั้ง **Vitest + React Testing Library + jsdom**; `vitest.config.ts` ใช้ `@vitejs/plugin-react`
  (Vitest 4 ใช้ rolldown/oxc — ต้องมี plugin ถึงจะ transform JSX/TSX ได้; alias `@`→src), `vitest.setup.ts` โหลด jest-dom matchers
- component tests (mock query hooks + `next/navigation`):
  - `status-badge.test.tsx` — label + caret
  - `status-menu.test.tsx` — agent เห็น dropdown transitions ที่อนุญาต + เรียก `mutate`; requester เห็น badge เฉย ๆ (ไม่มีเมนู)
  - `notifications-bell.test.tsx` — unread badge, เปิด dropdown, คลิก noti → mark read + navigate, empty state

**ไฟล์หลัก**
- `frontend/vitest.config.ts`, `frontend/vitest.setup.ts`, `frontend/package.json`,
  `frontend/src/components/ui/status-badge.test.tsx`,
  `frontend/src/features/tickets/components/status-menu.test.tsx`,
  `frontend/src/components/layout/notifications-bell.test.tsx`

**Verify**
- `npm test` (frontend) → **6 tests ผ่าน**; `npm run typecheck` + `next build` ยังผ่าน (11 routes)

**จบ Phase 5 (core)** — backend 34 (19 unit + 15 integration) + frontend 6 component = **40 tests**
**เลื่อน** — Playwright e2e + MSW (browser binaries + รันทั้ง stack → ทำใน Phase 6/CI)

---

## 2026-07-10 · Phase 5 (slice 2) — Backend integration tests (supertest)

**ทำ**
- test DB แยก `deskly_test` (ไม่ชนข้อมูล dev); refactor seed → `prisma/seed-fn.ts` (export `seedDatabase(prisma)`), `seed.ts` เหลือ CLI บาง ๆ
- harness: `vitest.integration.config.ts` (env DATABASE_URL→test + NODE_ENV=production/LOG silent, `fileParallelism:false`, globalSetup),
  `test/global-setup.ts` (สร้าง db ถ้ายังไม่มี + `prisma db push`), `test/db.ts` (`resetDb` = TRUNCATE … RESTART IDENTITY CASCADE + reseed ก่อนทุกเทสต์)
- `vitest.config.ts` (unit) exclude `*.integration.test.ts` → `npm test` ยัง DB-free; เพิ่ม script `test:integration`; ติดตั้ง supertest
- เทสต์ยิง `createApp()` ตรง (ไม่ต้อง listen); ครอบ auth (login/401/guard), tickets RBAC scoping + 409 transition + 403 write + 404 out-of-scope, create 201/400, comments internal 403 + ซ่อนจาก requester

**ไฟล์หลัก**
- `backend/vitest.config.ts`, `backend/vitest.integration.config.ts`,
  `backend/test/{global-setup,db,app.integration.test}.ts`, `backend/prisma/{seed-fn,seed}.ts`, `backend/package.json`

**Verify**
- `npm run test:integration` → **15 tests ผ่าน** (test DB); `npm test` (unit) → 19 tests ผ่าน DB-free; `npm run typecheck` ผ่าน
- dev DB (`deskly`) ไม่ถูกแตะ

**ค้าง** — frontend tests (RTL/Playwright/MSW); Phase 6 Docker/CI

---

## 2026-07-10 · Phase 5 (slice 1) — Backend unit tests (Vitest)

**ทำ**
- ตั้ง **Vitest** (scripts `test` = `vitest run`, `test:watch`)
- unit tests แบบ pure (ไม่แตะ DB) ครอบ domain invariant สำคัญ:
  - `domain.test.ts` — `canTransition` + whitelist (ถูกกฎ/ผิดกฎ/same-status/reopen-reject paths)
  - `sla.test.ts` — `computeDueAt` + `deriveSla` ครบทุก state (paused/met/ok/warn/danger, null due, format Xh Ym / Xd Yh, overdue clamp)
  - `auth.test.ts` — `permissionsFor` + `hasPermission` ต่อ role (admin `*`, agent มี ticket:write ไม่มี user:write, requester)

**ไฟล์หลัก**
- `backend/package.json` (+vitest +scripts), `src/shared/{domain,auth}.test.ts`, `src/modules/tickets/sla.test.ts`

**Verify**
- `npm test` → 3 files / **19 tests ผ่าน**; `npm run typecheck` ผ่าน (รวมไฟล์ test)

**ค้าง** — integration tests (supertest + test DB แยก), frontend tests (RTL/Playwright/MSW); Phase 6 Docker/CI

---

## 2026-07-10 · Phase 4 (slice 5, จบ Phase) — Users

**ทำ**
- โมดูล `users`: GET `/users` (directory), GET `/users/:id`, PATCH `/users/:id` (แก้ role/team)
  - RBAC: `user:read` (admin/manager/agent) / `user:write` (admin เท่านั้น ผ่าน `*`); PATCH เขียน audit `user.update`
- FE: feature `users` (schemas/api/queries) + แทนหน้า `Users` ที่เป็น ComingSoon ด้วย directory table จริง (avatar/name/email/role badge/team/joined)

**ไฟล์หลัก**
- backend: `src/modules/users/*`, `src/shared/auth.ts` (+`user:read`), `src/app.ts`
- frontend: `src/features/users/*`, `src/app/(app)/users/page.tsx`

**Verify**
- BE + FE `typecheck` ผ่าน; `next build` ผ่าน (11 routes; หน้า users เป็นเพจจริง)
- ผ่าน HTTP: Dana (agent) GET /users = 200 (11 users); Marcus (requester) = 403; Dana PATCH = 403;
  Ana (โปรโมตเป็น admin ชั่วคราว) PATCH role→manager = 200 + audit `user.update`; revert ด้วย re-seed

**จบ Phase 4** — ครบทุกโมดูลตาม spec (categories/create/audit/comments/notifications/attachments/users)

**ค้าง** — Phase 5 (Testing), Phase 6 (Docker/CI), Phase 7 (Deploy)

---

## 2026-07-10 · Phase 4 (slice 4) — Attachments (file upload)

**ทำ**
- `Attachment` model (ticketId/uploaderId/filename/contentType/sizeBytes/storageKey) + relations
- เพิ่ม `read(key)` ใน `IFileStorage` (Local อ่านจากดิสก์, S3 placeholder)
- โมดูล `attachments` + **multer** (memoryStorage, จำกัด 25MB): POST `/tickets/:id/attachments` (save ผ่าน `storage` + audit),
  GET list, GET `/attachments/:id` (download แบบ authed — stream bytes + Content-Disposition); ทุก endpoint scoped ผ่าน `ticketService.get`
- errorHandler รองรับ `MulterError` (LIMIT_FILE_SIZE → 413)
- ticket DTO: `attachments` count เป็นค่าจริงจาก Prisma `_count` (เลิก stub=0)
- FE: `api-client` ไม่เซ็ต Content-Type ถ้า body เป็น FormData; feature `attachments` (api/queries) + `AttachmentsPanel`
  (list + ปุ่ม upload + download แบบ blob พร้อม bearer token) ผูกใน properties rail แทนไฟล์ hardcode

**ไฟล์หลัก**
- backend: `prisma/schema.prisma` (+`Attachment`), `src/shared/storage.ts` (+`read`), `src/modules/attachments/*`,
  `src/middlewares/index.ts` (MulterError), `src/modules/tickets/ticket.repository.ts` (_count), `src/app.ts`
- frontend: `src/lib/api-client.ts` (FormData), `src/features/attachments/*`,
  `src/features/tickets/components/properties-rail.tsx`

**Verify**
- BE + FE `typecheck` ผ่าน; `next build` ผ่าน (11 routes)
- ผ่าน HTTP (HttpClient multipart): upload → 201 (dto ถูก); list = 1; ticket.attachments = 1 (count จริง);
  download → bytes ตรงเป๊ะ; out-of-scope upload 1029 → 404; audit `attachment.create`
- ล้าง attachments/audit + ลบไฟล์ `.uploads`

**ค้าง** — `users` (โมดูลสุดท้ายของ Phase 4)

---

## 2026-07-10 · Phase 4 (slice 3) — Notifications

**ทำ**
- `Notification` model (userId/type/ticketId/message/`readAt`) + relation บน User
- โมดูล `notifications`: GET `/notifications` (list + unread count), POST `/notifications/:id/read`,
  POST `/notifications/read-all` — scoped ต่อ user (mark ได้เฉพาะของตัวเอง)
- `notificationRepository.createMany(entries, tx)` เรียกจาก `ticket.updateStatus` + `comment.create` ใน tx เดียวกับ mutation
  - recipient = requester + assignee ยกเว้น actor; **internal note ไม่ส่งถึง requester**
- FE: `NotificationsBell` (unread badge จริง, dropdown list, mark read/all, คลิก → ไปหน้า ticket) + poll ทุก 30s;
  แทน bell ที่ hardcode "3" ใน topbar

**ไฟล์หลัก**
- backend: `prisma/schema.prisma` (+`Notification`), `src/modules/notifications/*`,
  `src/modules/tickets/ticket.repository.ts`, `src/modules/comments/comment.repository.ts`, `src/app.ts`
- frontend: `src/features/notifications/*`, `src/components/layout/{notifications-bell,topbar}.tsx`

**Verify**
- BE + FE `typecheck` ผ่าน; `next build` ผ่าน (11 routes)
- ผ่าน HTTP: Dana เปลี่ยน status 1042 → Marcus unread=1 (msg + ticketId ถูก), Dana (actor) = 0;
  Marcus comment → Dana ได้; Dana internal note → Marcus ไม่ได้ (ยัง 1); Dana public reply → Marcus unread=2;
  mark one/all read → 2→1→0
- ล้าง notifications/comments/audit + re-seed คืนสถานะ

**ค้าง** — `attachments` (upload จริง + count), `users`

---

## 2026-07-10 · Phase 4 (slice 2) — Comments (thread + internal notes)

**ทำ**
- `Comment` model (ticketId/authorId/body/internal/`deletedAt`) + relations บน Ticket/User
- โมดูล `comments`: GET/POST `/tickets/:id/comments`, DELETE `/comments/:id` (soft-delete)
  - list/create authorize ผ่าน `ticketService.get` (row scope → 404 ถ้านอกสิทธิ์)
  - internal note: เห็น + สร้างได้เฉพาะ role ที่มี `ticket:write` (requester → 403)
  - soft-delete: เจ้าของ หรือ manager/admin เท่านั้น; audit ทุก create/delete
  - เพิ่ม helper `hasPermission(user, perm)`
- เพิ่ม `description` + `createdAt` ใน ticket DTO (ให้ detail แสดง body จริง + เวลา opened)
- FE: `useComments`/`useCreateComment`; ticket detail แสดง description จริง + comments (สไตล์ internal note) แทน hardcode;
  Composer โพสต์ public/internal จริง (ซ่อนแท็บ note ถ้าเป็น requester) + loading state

**ไฟล์หลัก**
- backend: `prisma/schema.prisma` (+`Comment`), `src/modules/comments/*`, `src/shared/auth.ts` (+`hasPermission`),
  `src/modules/tickets/ticket.repository.ts` (DTO +`description`/`createdAt`), `src/app.ts`
- frontend: `src/features/tickets/{schemas,api,queries}.ts`,
  `src/features/tickets/components/{ticket-detail-view,composer}.tsx`

**Verify**
- BE + FE `typecheck` ผ่าน; `next build` ผ่าน (11 routes)
- ผ่าน HTTP: Dana reply/internal + Marcus reply = 201; Marcus internal = 403; Dana เห็น 4 (รวม internal),
  Marcus เห็น 3 (ซ่อน internal); out-of-scope 1029 GET/POST = 404; soft-delete = 204 (หายจาก list);
  audit_logs 4×`comment.create` + 1×`comment.delete`
- ล้าง comments ทดสอบคืนสถานะ seed

**ค้าง** — `attachments` (upload จริง + count), `notifications` (ยิงตอน transition), `users`

---

## 2026-07-10 · Phase 4 (slice 1) — Create-ticket + categories + audit

**ทำ**
- โมดูล `audit`: `AuditLog` model + `auditRepository.record(entry, tx)` — โมดูลอื่นเรียกใน `$transaction` ของตัวเอง → audit row commit พร้อม mutation
- โมดูล `categories`: GET `/api/v1/categories` (repository/service/controller/routes)
- create-ticket POST `/api/v1/tickets` (perm `ticket:create` — ให้ agent/manager/requester):
  validate category, requester = ผู้ล็อกอิน, `dueAt` คำนวณจาก priority, เขียน status-history + audit ใน tx เดียว;
  auto-assignment = unassigned → คิวทีมของ category (ผ่าน repository scope)
- audit ตอนเปลี่ยน status ด้วย (`ticket.status_change`)
- FE: `useCategories`/`useCreateTicket`; แปลง create-ticket modal เป็น controlled form (subject/description/category select/priority)
  → POST จริง → invalidate list + นำทางไปหน้า ticket ใหม่; error/pending states

**ไฟล์หลัก**
- backend: `prisma/schema.prisma` (+`AuditLog`), `src/modules/audit/audit.repository.ts`, `src/modules/categories/*`,
  `src/modules/tickets/{ticket.repository,ticket.service,ticket.controller,ticket.routes,ticket.validators}.ts`,
  `src/shared/auth.ts`, `src/app.ts`
- frontend: `src/features/tickets/{schemas,api,queries}.ts`, `src/features/tickets/components/create-ticket-modal.tsx`

**Verify**
- BE + FE `typecheck` ผ่าน; `next build` ผ่าน (11 routes)
- ผ่าน HTTP: GET /categories = 6 หมวด; agent สร้าง → 201 (id ต่อจาก demo, status new, SLA คำนวณ);
  requester สร้าง → 201 (priority default medium); subject สั้น/category ผิด → 400; ticket ใหม่โผล่ใน scoped list;
  `audit_logs` (ticket.create) + `ticket_status_history` (→ new) มีแถวครบ
- ล้าง ticket ทดสอบ (1045/1046) + re-seed คืนสถานะ

**ค้าง** — `users`, `comments` (soft-delete), `attachments` (`IFileStorage`), `notifications` (ยิงตอน transition); attachments count ยัง stub=0

---

## 2026-07-09 · Phase 3 (จบ) — RBAC + row-level scoping

**ทำ**
- middleware `requirePermission(perm)` (admin ถือ `*`) — ใส่ที่ PATCH status ให้ต้องมี `ticket:write`
- access token / `AuthUser` เพิ่ม `teamId` + `department` เพื่อใช้ทำ scope; auth repo include `team`
- row-level scoping ใน `ticket.repository` ด้วย `scopeWhere(user)` (AND กับ filter เดิม):
  requester=ของตัวเอง · agent=own + คิวทีม (assignee.teamId หรือ unassigned ที่ category route มาที่ทีม) ·
  manager=own + ทุกทีมในแผนก · admin=ทั้งหมด — `findById` ใช้ `findFirst` + scope → นอก scope = 404
- thread `AuthUser` ผ่าน controller → service → repository (`list`/`get`/`changeStatus`)
- Frontend: `StatusMenu` (dropdown transitions ที่อนุญาต → `useUpdateTicketStatus`) ใน properties rail +
  ปุ่ม "Mark resolved"; ซ่อน write UI ถ้า role เป็น requester; แสดง error เมื่อ mutation ล้มเหลว
- เพิ่ม `Forbidden` (403); ปรับ `ROLE_PERMISSIONS` (requester ได้ `ticket:read` — read คุมด้วย scope ไม่ใช่ permission)

**ไฟล์หลัก**
- backend: `src/middlewares/auth.ts`, `src/shared/{auth,errors}.ts`, `src/modules/auth/{auth.tokens,auth.repository,auth.service}.ts`,
  `src/modules/tickets/{ticket.repository,ticket.service,ticket.controller,ticket.routes}.ts`
- frontend: `src/features/tickets/components/{status-menu.tsx,properties-rail.tsx,ticket-detail-view.tsx}`

**Verify**
- BE + FE `typecheck` ผ่าน; `next build` ผ่าน (11 routes)
- ผ่าน HTTP (seed จริง): Dana (agent/IT Support) เห็น 7 ใบ (ไม่มี 1029) · Kai (agent/Field Services) เห็นเฉพาะ 1029 ·
  Marcus (requester) เห็นเฉพาะ 1042 (ของตัวเอง)
- GET นอก scope (Dana→1029, Marcus→1039) → 404; GET ของตัวเอง (Marcus→1042) → 200
- PATCH status: requester (Marcus) → 403; agent ในสโคป (Dana→1035) → 200; agent นอกสโคป (Dana→1029) → 404

**ค้าง** — create-ticket POST จริง + ผูก modal; attachments count จริง (stub=0); modules ที่เหลือ (Phase 4);
transition ที่ requester ทำได้เอง (เช่น resolved→open reject) ยังไม่เปิด

---

## 2026-07-09 · Phase 3 (บางส่วน) — Auth จริง (JWT + refresh rotation)

**ทำ**
- Backend auth module เต็ม: `login` / `refresh` / `logout` / `me`
- JWT access token 15 นาที (jsonwebtoken) พก `role` + `permissions[]`; refresh token 7 วัน เป็น opaque random เก็บเฉพาะ SHA-256 hash ใน `RefreshToken`
- refresh แบบ rotate; ตรวจ reuse (token ที่ revoke แล้ว → ล้าง family ทั้งชุด); logout revoke family + เคลียร์ cookie
- bcryptjs hash password (เลี่ยง native module เพราะ env นี้บล็อก postinstall script)
- middleware `requireAuth` (Bearer → `req.user`) + cookie-parser; ป้องกัน route `tickets`/`dashboard`/`reports`; บันทึก actor ลง `ticket_status_history`
- Frontend: token store ใน memory, `api-client` แนบ Authorization + 401→refresh→retry, `AuthProvider`/`RequireAuth`/bootstrap ผ่าน refresh cookie, `/login` เรียก API จริง (ลบ password hardcode), sidebar แสดง user จริง + ปุ่ม sign out

**ไฟล์หลัก**
- backend: `src/modules/auth/{auth.tokens,auth.repository,auth.service,auth.controller,auth.validators,auth.routes}.ts`,
  `src/middlewares/auth.ts`, `src/shared/auth.ts`, `src/types/express.d.ts`, `src/app.ts`, `src/config/env.ts`,
  `prisma/schema.prisma` (+`RefreshToken`), `prisma/seed.ts` (password hash)
- frontend: `src/features/auth/{token-store,schemas,api,context,require-auth}.*`, `src/lib/api-client.ts`,
  `src/app/providers.tsx`, `src/app/(app)/layout.tsx`, `src/app/login/page.tsx`, `src/components/layout/sidebar.tsx`

**Verify**
- BE + FE `typecheck` ผ่าน; `next build` ผ่าน (11 routes)
- ผ่าน HTTP: ไม่มี token → 401; login ถูก → 200 + cookie; รหัสผิด → 401; `/me` → user จริง; refresh rotate (rt1≠rt2);
  reuse rt เก่า → 401 + family ถูก revoke (rt ใหม่ก็ 401); logout แล้ว refresh → 401
- CORS: preflight 204, `ACAO=http://localhost:3000`, `ACAC=true`, Set-Cookie `HttpOnly; SameSite=Lax; Path=/api/v1/auth`

**ค้าง** — RBAC `requirePermission` + row-level scoping (WHERE) ใน repository; ผูกปุ่มเปลี่ยน status ฝั่ง FE เข้า write path (Phase 3 ที่เหลือ)

---

## 2026-07-09 · Phase 2 — PostgreSQL + Prisma

**ทำ**
- docker-compose service `postgres` (postgres:16-alpine) + healthcheck
- เลือก **Prisma** (ORM + Prisma Migrate) เป็น data layer; import Prisma เฉพาะใน repository / seed / singleton (คงหลัก "service ไม่แตะ data layer")
- schema normalized: `teams`, `users`, `categories`, `tickets`, `ticket_status_history`; enums ตรงกับ `shared/domain.ts`
- tickets repository cutover เป็น Prisma — `Ticket` DTO + method signatures + API contract ไม่เปลี่ยน (controller/routes/validators/frontend ไม่แตะ)
- `updateStatus` ใช้ `$transaction` เขียน `ticket_status_history` (SLA source of truth); `sla.ts` คำนวณ `slaDue`/`slaState` จาก `due_at` + status
- seed จากข้อมูล demo เดิม (คง ticket id 4 หลัก + reset id sequence)

**ไฟล์หลัก**
- `docker-compose.yml`, `backend/prisma/{schema.prisma,seed.ts,migrations/**}`, `backend/src/shared/db.ts`,
  `backend/src/modules/tickets/{sla,ticket.repository,ticket.service}.ts`, `backend/package.json`, `backend/.env(.example)`

**Verify**
- `typecheck` ผ่าน; `docker compose up -d postgres` + `prisma migrate dev` + `db:seed` สำเร็จ
- `GET /tickets` (+ filter), `GET /tickets/:id` คืน shape เดิมพร้อม SLA คำนวณจาก Postgres
- PATCH status ถูกกฎ → 200 + เพิ่มแถว `ticket_status_history`; ผิดกฎ → 409 ILLEGAL_TRANSITION

**หมายเหตุ env** — npm บนเครื่องนี้บล็อก postinstall script ต้องรัน `npx prisma generate` เองหลัง `npm install`

**ค้าง** — auth จริง (Phase 3); attachments count จริง (stub=0 รอ Attachment model); modules ที่เหลือ (Phase 4)

---

## 2026-07-09 · Phase 1 — เชื่อม Frontend ↔ Backend

**ทำ**
- Frontend ดึงข้อมูลจาก API จริงแล้ว (เลิกใช้ mock data) ผ่าน **TanStack Query** + fetch client
- `src/lib/api-client.ts` — fetch wrapper (base URL จาก `NEXT_PUBLIC_API_URL`, `credentials: include`,
  unwrap `{data}`, error → `ApiError` code/message), `src/lib/logger.ts` (client logger)
- `src/app/providers.tsx` — `QueryClientProvider` mount ใน root layout
- แต่ละ feature มี `schemas.ts` (zod) + `api.ts` + `queries.ts`: tickets, dashboard, reports
- เปลี่ยน component เป็น client + useQuery พร้อม loading/error/empty states:
  TicketTable, TicketListFooter, MyTickets, TicketDetailView, StatCards, charts, ReportsBody
- Backend: เพิ่ม field `slaState` ใน ticket payload เพื่อให้ FE ลงสี SLA ตรงดีไซน์

**ไฟล์หลัก**
- `frontend/src/lib/{api-client,logger}.ts`, `frontend/src/app/providers.tsx`,
  `frontend/src/features/{tickets,dashboard,reports}/{schemas,api,queries}.ts` + components,
  `frontend/.env.example`, `backend/src/modules/tickets/ticket.repository.ts`

**Verify**
- `next build` ผ่าน (11 routes, type+lint สะอาด) · backend `typecheck` ผ่าน
- รัน FE (:3000) + BE (:4000) พร้อมกัน — screenshot ทั้ง 4 หน้า (dashboard/tickets/reports/detail)
  แสดงข้อมูลจาก API จริง; ticket detail ต่าง id แสดงข้อมูลต่างกัน (per-id fetch)
- backend log ยืนยันเห็น request `/api/v1/tickets/:id`, `/dashboard/summary`, `/reports/sla-summary`
  พร้อม reqId; zod parse ผ่าน (ถ้า payload ผิด schema จะขึ้น error state)

**ค้าง** — mutation (เปลี่ยน status) มี `useUpdateTicketStatus` แล้วแต่ปุ่มยังไม่ผูก;
create-ticket modal ยังไม่ POST จริง; auth จริง/refresh (Phase 3); PostgreSQL (Phase 2)

---

## 2026-07-09 · Phase 0 — ระบบ logging + เอกสาร

**ทำ**
- เพิ่ม structured logging ใน backend ด้วย `pino` + `pino-http` (pretty ตอน dev)
- ทุก request มี `reqId` (รับต่อจาก header `x-request-id` ถ้ามี ไม่งั้น gen ใหม่) และตอบกลับใน response header
- log level อัตโนมัติตาม status (5xx=error, 4xx=warn, อื่น ๆ=info)
- redact header `authorization` / `cookie` / `set-cookie` ไม่ให้ token หลุดเข้า log
- `errorHandler` log ผ่าน `req.log` → error ผูกกับ `reqId` ของ request
- สร้างเอกสาร: DEVLOG (ไฟล์นี้), CHANGELOG, ROADMAP

**ไฟล์หลัก**
- `backend/src/shared/logger.ts` (ใหม่), `backend/src/app.ts`, `backend/src/middlewares/index.ts`,
  `backend/src/config/env.ts`, `backend/src/server.ts`, `backend/.env.example`, `backend/package.json`
- `docs/DEVLOG.md`, `docs/ROADMAP.md`, `CHANGELOG.md`

**Verify**
- `npm run typecheck` ผ่าน · `npm run dev` startup log เป็น pretty
- `curl /api/v1/health` → request log พร้อม `reqId` + `responseTime`
- 409 ILLEGAL_TRANSITION → warn log ผูก `reqId` เดียวกับ request log
- header อ่อนไหวถูก redact เป็น `[Redacted]`

**ค้าง** — logging ฝั่ง frontend (optional), ใช้ `req.log` ลึกใน service ผ่าน AsyncLocalStorage (roadmap)

---

## 2026-07-09 · แยก monorepo + scaffold backend

**ทำ**
- ย้าย Next.js app ทั้งหมดไปไว้ใต้ `frontend/`; root เหลือ `CLAUDE.md` + `.claude/`
- สร้าง `backend/` — Express + TypeScript, versioned REST `/api/v1`, vertical-slice modules
- modules: `auth` (login stub), `tickets` (list/get/status + transition guard), `dashboard`, `reports`, `kb`
- shared: `IFileStorage` adapter (local/s3), typed errors (AppError + 409 ILLEGAL_TRANSITION), domain enums
- middlewares: asyncHandler, notFound, errorHandler (AppError + Zod)

**ไฟล์หลัก** — `backend/src/{server,app}.ts`, `backend/src/modules/**`, `backend/src/shared/**`,
`backend/src/middlewares/index.ts`, อัปเดต `CLAUDE.md`

**Verify** — `npm install` + `typecheck` ผ่าน; smoke-test ทุก endpoint (health / tickets filter /
ticket by id / 409 illegal transition / login) ผ่านทั้งหมด

**ค้าง** — PostgreSQL, auth จริง, modules ที่เหลือ, เชื่อม frontend เข้ากับ API

---

## 2026-07-09 · Import Claude Design + สร้าง frontend

**ทำ**
- Import โปรเจกต์ Claude Design "Enterprise Help Desk System" ผ่าน `claude_design` MCP
- Implement `Help Desk WebApp.dc.html` เป็น Next.js 15 (App Router) + TypeScript + Tailwind 3 + lucide-react
- 6 หน้าจอ production: Login, Dashboard, Ticket list, Ticket detail, Reports, + Create-ticket modal
- design tokens ตรงตาม handoff (สี/สถานะ/priority/รัศมี/เงา), Geist + Geist Mono, shell (sidebar + topbar)
- โครง `features/{tickets,dashboard,reports}` + `components/ui` + `lib/domain.ts` (enum + transition whitelist)

**ไฟล์หลัก** — `frontend/src/app/**`, `frontend/src/features/**`, `frontend/src/components/**`,
`frontend/src/lib/**`, config Next/Tailwind/tsconfig

**Verify** — `next build` ผ่าน (11 routes, type + lint สะอาด); รันจริง + screenshot ครบ 5 หน้าจอ ตรงดีไซน์

**ค้าง** — ยังใช้ mock data (ยังไม่เรียก API), dark ops-console variant (`1g`) ไม่ได้ทำ (เป็น comparison option)
