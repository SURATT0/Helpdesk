# ระบบรับเรื่องผ่านฟอร์ม → เปิดตั๋วใน Deskly — System Design

- **สถานะ:** Draft — for implementation
- **เวอร์ชัน:** 0.3
- **อัปเดต:** 21 ก.ย. 2026
- **ผู้ดูแล:** Surat · Bluefish

การออกแบบระบบสำหรับฟอร์มแจ้งเรื่องสาธารณะ ตั้งแต่รับข้อมูล → เก็บลงฐานข้อมูล → ส่งอีเมลยืนยัน → เปิดตั๋วเข้าคิว triage ของ Deskly โดยรองรับการตอบกลับทางอีเมล (email-to-ticket) และเป็นไปตาม PDPA

---

## 01 · ภาพรวมและเป้าหมาย

ฟอร์มแจ้งเรื่องเป็นช่องทางสาธารณะ (public) สำหรับลูกค้าภายนอกส่งคำขอเข้ามาโดยไม่ต้องล็อกอิน คำขอทุกรายการต้องกลายเป็น "ตั๋ว" ในระบบ Deskly พร้อมเลขอ้างอิงที่ส่งกลับทางอีเมลทันที

เป้าหมาย 4 ข้อ:

1. เก็บข้อมูลคำขออย่างครบถ้วนและตรวจสอบย้อนหลังได้
2. ออกเลขที่ตั๋วที่ไม่ซ้ำและเชื่อถือได้จากฝั่งเซิร์ฟเวอร์
3. ส่งอีเมลยืนยันให้ผู้แจ้งและแจ้งเตือนทีม พร้อมผูกการตอบกลับเข้ากับตั๋วเดิม
4. เก็บหลักฐานการยินยอม (consent) ตาม PDPA

**ขอบเขต:** ครอบคลุมตั้งแต่ฟอร์ม (มีอยู่แล้ว) จนถึงการเปิดตั๋วสถานะ `New` ในคิว triage การมอบหมายลูกค้า/โปรเจกต์/ผู้รับผิดชอบต่อจากนั้นเป็นงานของเจ้าหน้าที่ในระบบ Deskly ปกติ ไม่อยู่ในเอกสารนี้

---

## 02 · สถาปัตยกรรม

รับเรื่องเป็น **โมดูลสาธารณะภายใน Deskly** (route group `/api/public/*`) ไม่ใช่ service แยก เพื่อใช้โมเดล/Prisma/ตัวออกเลขตั๋ว/email-to-ticket ของ Deskly ร่วมกันโดยตรง ทุกอย่างเกิดในทรานแซกชันเดียว: เขียน DB สำเร็จก่อน แล้วจึงส่งอีเมล

```
[ ฟอร์มแจ้งเรื่อง (Browser) ]           หน้า HTML สแตติก · ตรวจ client + honeypot
            │  HTTPS · JSON/multipart POST · CORS จำกัด origin
            ▼
[ Public API — POST /api/public/tickets ]  (จุดศูนย์กลาง)
            │  honeypot → validate → rate-limit → จับคู่ Customer → เขียน DB → ส่งเมล → ตอบเลขตั๋ว
            ▼  (ทรานแซกชันเดียว)
   ┌──────────────────────┐   ┌──────────────────────┐
   │ PostgreSQL · Prisma  │   │ Mailer · Nodemailer  │
   │ IntakeSubmission     │   │ ยืนยันผู้แจ้ง + แจ้งทีม │
   │ Ticket · ConsentLog  │   └──────────────────────┘
   │ Attachment           │
   └──────────────────────┘
            │  ไฟล์แนบ (ถ้ามี)
            ▼
[ ตรวจ (ขนาด/magic bytes) → Quarantine → สแกน ClamAV → Object storage (S3/disk) ]
            │
            ▼
[ Deskly Core ]  คิว Triage → มอบหมาย Customer / Project / Category · SLA · สถานะ
            ▲│  ผู้แจ้งตอบกลับอีเมล (Reply-To = กล่อง support)
            ▼
[ Email-to-Ticket ]  จับเลขที่ตั๋วจาก subject/headers → แนบข้อความเข้าตั๋วเดิม
```

> **การตัดสินใจ — สร้างรวมใน Deskly:** สร้างเป็นโมดูลสาธารณะภายใน Deskly ไม่แยกเป็น service เพราะ `Ticket`, `Customer/Project/Category`, ตัวออกเลขตั๋ว และ email-to-ticket อยู่ใน Deskly อยู่แล้ว การแยกจะทำให้ต้องก๊อป/ซิงก์ schema โดยไม่ได้ประโยชน์ชัด — แยก "พื้นผิวสาธารณะ" ด้วยโค้ด (route group + middleware เฉพาะ) ไม่ใช่ด้วยเซิร์ฟเวอร์คนละตัว
>
> **ยกเว้น** มีนโยบายบังคับแยก DMZ: ทำ edge เบา ๆ (รับฟอร์ม + validate + สแกนไฟล์) แล้วเรียก internal API ของ Deskly หรือเขียน Postgres ฐานเดียวกัน เพื่อให้เจ้าของ Ticket/เลขตั๋วยังเป็น Deskly ตัวเดียว

---

## 03 · โฟลว์การส่งเรื่อง

1. **Client ส่งข้อมูล** — ฟอร์มตรวจฝั่ง client แล้ว `POST` ถ้าช่อง honeypot (`website`) ถูกกรอกจะไม่ส่ง
2. **ตรวจ honeypot ฝั่งเซิร์ฟเวอร์** — ถ้ามีค่า ตอบ `201` พร้อมเลขปลอม แต่ตั้ง flag `spam` และไม่ส่งอีเมล
3. **Validate ซ้ำฝั่งเซิร์ฟเวอร์** — ไม่เชื่อ client; ตรวจทุกฟิลด์ + ความยินยอม ถ้าไม่ผ่านตอบ `400/422` โดยยังไม่เขียน DB
4. **Rate-limit** — จำกัดต่อ IP และต่ออีเมล ถ้าเกินตอบ `429`
5. **จับคู่ลูกค้า** — เทียบโดเมนอีเมลบริษัทกับตาราง Customer ถ้าเจอผูก `customerId` ถ้าไม่เจอปล่อยว่างไว้ให้ triage
6. **ออกเลขที่ตั๋ว + เขียน DB** — ภายในทรานแซกชันเดียว สร้าง `IntakeSubmission`, `Ticket` (สถานะ `New`), `ConsentLog` และเมทาดาทาไฟล์แนบใน `Attachment` (สถานะสแกน `pending`)
7. **จัดการไฟล์แนบ** — ตรวจขนาด/ชนิดฝั่งเซิร์ฟเวอร์ → กักไว้ → สแกนไวรัส → ย้ายเข้าที่เก็บ (ดูข้อ 08) ทำ async ได้ ตั๋วไม่ต้องรอ
8. **ส่งอีเมล** — หลัง commit สำเร็จ ส่ง 2 ฉบับ: ยืนยันถึงผู้แจ้ง + แจ้งทีม การส่งเมลล้มเหลว "ไม่" ทำให้ตั๋วล้ม (เข้าคิว retry แทน)
9. **ตอบกลับ** — `201` พร้อม `ticketNumber` ฟอร์มแสดงหน้า success

> **ลำดับสำคัญ:** เขียน DB ให้สำเร็จ "ก่อน" ส่งอีเมลเสมอ หากอีเมลส่งไม่ออก ให้ log + คิว retry ไม่ใช่ rollback ตั๋ว

---

## 04 · โครงสร้างข้อมูล

แยกเป็น 3 ตารางหลัก + `Attachment` เพื่อให้ตรวจสอบย้อนหลังและลบข้อมูลตาม PDPA ได้โดยไม่กระทบตั๋ว

### IntakeSubmission — payload ดิบจากฟอร์ม

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| id | uuid | คีย์หลัก |
| ticketId | uuid? | ผูกกับ Ticket ที่สร้าง (null ถ้าเป็น spam) |
| name | string | ชื่อ-นามสกุลผู้แจ้ง |
| businessEmail | string | อีเมลบริษัท (ใช้จับคู่ Customer) |
| companyName | string | ชื่อบริษัท/หน่วยงาน |
| phone | string | เบอร์ติดต่อกลับ |
| service | enum | รหัสบริการที่เลือก (เช่น `rpa-consult`) |
| message | text | รายละเอียดปัญหา (สูงสุด 2000) |
| source | string | `web-intake-form` |
| status | enum | `linked` · `triage` · `spam` |
| isFreeMail | bool | flag ถ้าใช้อีเมลฟรี (gmail ฯลฯ) |
| ip / userAgent | string | สำหรับ audit + rate-limit |
| submittedAt | datetime | เวลาที่ client ส่ง |
| createdAt | datetime | เวลาที่เซิร์ฟเวอร์บันทึก |

### Ticket — ตั๋วใน Deskly (ฟิลด์ที่ intake เขียน)

| ฟิลด์ | ค่าที่ intake ตั้ง | หมายเหตุ |
|---|---|---|
| number | `BF-YYYYMMDD-####` | เลขที่ตั๋ว ออกจากเซิร์ฟเวอร์ (ดูข้อ 06) |
| subject | ชื่อบริการ + companyName | สรุปสั้นสำหรับคิว |
| description | message | เนื้อหาที่ผู้แจ้งกรอก |
| channel | `web-intake` | แยกช่องทางออกจาก email/manual |
| status | `New` | เข้าคิว triage เสมอ |
| customerId | จับคู่จากโดเมน หรือ `null` | null = รอ triage ผูกลูกค้า |
| projectId / categoryId | `null` | เจ้าหน้าที่เลือกตอน triage (Category ผูกกับ Customer) |
| reportedAt | = submittedAt | แยกจาก createdAt/importedAt ตามดีไซน์ Deskly |
| excludedFromReports | `false` (spam = `true`) | ใช้ flag junk ticket ที่มีอยู่ |

### โมเดลสถานะตั๋ว (อ้างอิง Deskly)

`New` → `In Progress` (derived) → `Pending` (รอข้อมูลเพิ่มเติม) → `Resolved` → `Closed` (two-sided)

ตั๋วจากฟอร์มเริ่มที่ `New` เสมอ "In Progress" เป็นสถานะ derived (ไม่ใช่คอลัมน์ใน DB) และการปิดตั๋วยังต้องมี resolution details + การยืนยันจากผู้แจ้งตามกฎเดิมของ Deskly

### การจับคู่บริการและลูกค้า

- **service → หมวดที่แนะนำ:** เก็บ `service` ดิบไว้ และทำ lookup ไปยัง service catalog เพื่อ "เสนอ" Category ตอน triage (ยังไม่ผูกตายตัว เพราะ Category ผูกกับ Customer)
- **อีเมล → Customer:** เทียบโดเมนของ `businessEmail` กับโดเมนที่ลงทะเบียนไว้ของ Customer เจอ → ผูกอัตโนมัติ, ไม่เจอ → ค้างที่ triage

---

## 05 · API Contract

- **Method:** POST
- **Path:** `/api/public/tickets`
- **Auth:** ไม่มี (public) — ป้องกันด้วย CORS allowlist + rate-limit + honeypot
- **Content-Type:** `application/json` หรือ `multipart/form-data` (เมื่อมีไฟล์แนบ)

### Request body

```json
{
  "name":          "สุรัตน์ ใจดี",
  "businessEmail": "somchai@company.co.th",
  "companyName":   "บริษัท ตัวอย่าง จำกัด",
  "phone":         "081-234-5678",
  "service":       "rpa-consult",
  "message":       "อยากปรึกษาเรื่องวางระบบ RPA ...",
  "consent":       true,
  "source":        "web-intake-form",
  "submittedAt":   "2026-09-21T09:30:00.000Z",
  "website":       ""
}
```

### Responses

```
201 Created    { "ticketNumber":"BF-20260921-0042", "ref":"BF-20260921-0042",
                 "status":"received", "receivedAt":"2026-09-21T09:30:01.201Z" }
400 Validation   { "error":"validation", "fields":{ "email":"รูปแบบอีเมลไม่ถูกต้อง" } }
413 File too large { "error":"file_too_large", "max":"10MB" }
415 Bad file type  { "error":"unsupported_type" }
422 No consent   { "error":"consent_required" }
429 Rate limited { "error":"rate_limited", "retryAfter":60 }
500 Server error { "error":"server_error" }
```

- **มีไฟล์แนบ:** ฟอร์มส่งเป็น `multipart/form-data` (ฟิลด์เดิม + ไฟล์ในคีย์ `attachments`)
- **ไม่มีไฟล์:** ส่ง JSON ตามด้านบน
- ฟอร์มปัจจุบันอ่าน `data.ticketNumber` หรือ `data.ref` อยู่แล้ว จึงเข้ากันได้ทันทีเมื่อกำหนดค่า `ENDPOINT`

---

## 06 · การออกเลขที่ตั๋ว

รูปแบบ `BF-YYYYMMDD-####` โดยลำดับ 4 หลักรีเซ็ตรายวัน เลขต้องออกจากเซิร์ฟเวอร์เท่านั้น (`mockRef()` ในฟอร์มใช้เฉพาะโหมดสาธิต)

- **กันเลขซ้ำ:** unique constraint ที่คอลัมน์ `number` + ออกเลขในทรานแซกชันเดียวกับการสร้างตั๋ว
- **กัน race:** ใช้ advisory lock ต่อวัน หรือตาราง `ticket_counter(day, seq)` แล้ว `UPDATE ... RETURNING` เพื่อ increment แบบ atomic — ห้ามใช้ `count(*)+1`
- **Retry:** ถ้าชน unique ให้ดึง seq ใหม่แล้วลองซ้ำสูงสุด 3 ครั้ง

---

## 07 · อีเมล & email-to-ticket

ส่ง 2 ฉบับต่อคำขอ และออกแบบ header ให้การตอบกลับผูกกลับเข้าตั๋วเดิมได้

### ฉบับที่ 1 — ยืนยันถึงผู้แจ้ง
- **To:** businessEmail
- **Subject:** `[BF-20260921-0042] รับเรื่องแล้ว — RPA Consulting`
- **Reply-To:** กล่อง support (เพื่อให้การตอบกลับเข้า email-to-ticket)
- **Body:** ทักทาย + เลขที่ตั๋ว + สรุปเรื่อง + ขั้นตอนถัดไป

### ฉบับที่ 2 — แจ้งทีม
- **To:** `SUPPORT_INBOX`
- **Subject:** `[BF-20260921-0042] ใหม่ — บริษัท ตัวอย่าง จำกัด`
- **Body:** ทุกฟิลด์ + สถานะจับคู่ Customer + ลิงก์ไปตั๋วใน Deskly

> **ผูกกับ email-to-ticket:** ใส่เลขที่ตั๋วใน subject และตั้ง `Message-ID` เมื่อผู้แจ้งตอบกลับ ตัวประมวลผล inbound จับเลขจาก subject (หรือ `In-Reply-To`/`References`) แล้วแนบเป็น comment ในตั๋วเดิม แทนที่จะเปิดตั๋วใหม่

---

## 08 · ไฟล์แนบ — ตรวจสอบ · ที่เก็บ · สแกนไวรัส

ฟอร์มจำกัด 10 MB/ไฟล์อยู่แล้ว แต่ต้อง "ตรวจซ้ำทุกอย่างฝั่งเซิร์ฟเวอร์" ห้ามเชื่อ client เด็ดขาด ไฟล์ทุกชิ้นเข้าโซนกัก (quarantine) ก่อน ผ่านการสแกน แล้วจึงเก็บและผูกกับตั๋ว

### 1. ตรวจสอบฝั่งเซิร์ฟเวอร์
- **ขนาด:** จำกัดที่ middleware (เช่น multer `limits.fileSize = 10 MB`), จำนวน ≤ 5, รวม ≤ 25 MB เกินตอบ `413` โดยหยุดรับ stream ทันที
- **ชนิดไฟล์ (สำคัญสุด):** allowlist เท่านั้น และตรวจ *magic bytes / file signature* ของไฟล์จริง (เช่น `file-type`) ไม่เชื่อ `Content-Type`/นามสกุล — ไฟล์ `.exe` ที่เปลี่ยนชื่อเป็น `.png` ต้องถูกจับ ไม่ผ่านตอบ `415`
- **ปฏิเสธชนิดอันตราย:** executable, `.html`, `.svg` (ฝัง script ได้) ฯลฯ — ใช้ allowlist (รูปภาพ, PDF, Office, CSV/TXT, ZIP)
- **ชื่อไฟล์:** สร้างชื่อใหม่ `uuid.ext` กัน path traversal/ทับกัน เก็บชื่อเดิมเป็น metadata
- **checksum:** คำนวณ `sha256` ไว้ตรวจซ้ำและกันไฟล์ซ้ำ

### 2. ที่เก็บไฟล์ (disk / S3)
แยกไฟล์ออกจากฐานข้อมูล — DB เก็บแค่ metadata + storage key ผ่าน interface กลางที่สลับ backend ได้ด้วย env

- **Interface:** `StorageProvider { put · get · delete · signedUrl }`
- **Disk (dev):** เก็บนอก webroot, ชื่อ uuid, สิทธิ์จำกัด, ห้าม serve ตรง
- **S3 (prod):** bucket ส่วนตัว (ไม่ public), เข้ารหัส at-rest, เข้าถึงผ่าน pre-signed URL อายุสั้น
- **Key:** `attachments/{ticketId}/{uuid}.{ext}`
- **Lifecycle:** ลบไฟล์ของ submission ที่เป็น triage/spam ตามอายุ (สอดคล้อง PDPA)

> **ห้าม:** serve ไฟล์แนบจาก URL สาธารณะตรง ๆ — ทุกการเข้าถึงต้องผ่าน API ที่ตรวจสิทธิ์ แล้วคืน pre-signed URL อายุสั้น หรือ proxy stream

### 3. สแกนไวรัส
- **ClamAV (clamd)** เป็น service ใน docker-compose ไฟล์จากโซนกักถูกส่งไปสแกนก่อนย้ายเข้าที่เก็บจริง
- **ผลลัพธ์:** `clean` → ย้ายเข้าที่เก็บ + ผูกตั๋ว · `infected` → ลบ/กัก + แจ้ง admin + ไม่แนบเข้าตั๋ว · `error` → คง `pending` แล้ว retry
- **จังหวะสแกน:** async หลังตอบ `201` ได้ (ผู้แจ้งไม่ต้องรอ) โดยไฟล์ "ยังไม่พร้อมใช้งาน" จนสแกนผ่าน
- **สเกลใหญ่:** upload → event → worker/Lambda สแกน หรือใช้บริการสแกนภายนอก

### ตาราง Attachment

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| id | uuid | คีย์หลัก |
| ticketId / submissionId | uuid | ผูกกับตั๋วและ payload ดิบ |
| originalName | string | ชื่อไฟล์เดิม (แสดงผลเท่านั้น) |
| storedKey | string | key ในที่เก็บ (uuid.ext) |
| mimeType | string | ชนิดที่ยืนยันด้วย magic bytes |
| sizeBytes | int | ขนาดจริงหลังรับครบ |
| checksum | string | sha256 |
| storageProvider | enum | `disk` · `s3` |
| scanStatus | enum | `pending` · `clean` · `infected` · `error` |
| createdAt | datetime | เวลาบันทึก |

---

## 09 · Validation & การกันสแปม

- **Honeypot** — ช่อง `website` ที่ซ่อนไว้ ถ้ามีค่าถือว่าเป็นบอท
- **Validate ฝั่งเซิร์ฟเวอร์** — สะท้อนกฎ client ทั้งหมด (ชื่อ ≥2, อีเมลถูกรูปแบบ, เบอร์ 9–15 หลัก, message ≥15)
- **Rate limit** — เช่น 5 ครั้ง/นาที และ 20 ครั้ง/ชม. ต่อ IP + เพดานต่ออีเมล
- **อีเมลฟรี** — ไม่บล็อกที่เซิร์ฟเวอร์ แต่ตั้ง flag `isFreeMail` ไว้ให้ triage
- **Sanitize** — จำกัดความยาว, strip HTML/สคริปต์ในทุกฟิลด์ก่อนเก็บ/ส่งเมล
- **เผื่ออนาคต** — เพิ่ม Cloudflare Turnstile/reCAPTCHA ได้ถ้าโดนสแปมหนัก

---

## 10 · ความปลอดภัย & PDPA

- **หลักฐานยินยอม** — ต้อง `consent = true` ไม่งั้น `422`; เก็บ `ConsentLog` (ข้อความ consent, เวอร์ชัน, เวลา, IP, UA)
- **Data minimization + retention** — กำหนดอายุลบข้อมูล triage/spam ที่ไม่กลายเป็นตั๋วจริง (เช่น 90 วัน)
- **สิทธิเจ้าของข้อมูล** — ค้น/ลบตาม email ได้ (แยกตาราง submission/consent/attachment ออกจากตั๋ว)
- **ความลับ** — TLS ทุกชั้น, secrets อยู่ใน env, CORS จำกัดเฉพาะ origin ของฟอร์ม, ไม่ log PII (mask อีเมล)

---

## 11 · การตั้งค่า (ENV)

```bash
DATABASE_URL=postgresql://user:pass@db:5432/deskly
PORT=8080
PUBLIC_FORM_ORIGIN=https://bluefishsolution.com   # CORS allowlist

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM="Bluefish Support <support@bluefishsolution.com>"
SUPPORT_INBOX=support@bluefishsolution.com

TICKET_PREFIX=BF
RATE_LIMIT_PER_MIN=5
RATE_LIMIT_PER_HOUR=20
DESKLY_BASE_URL=https://deskly.bluefishsolution.com

# ---- ไฟล์แนบ ----
MAX_FILE_MB=10
MAX_FILES=5
MAX_TOTAL_MB=25
ALLOWED_MIME=image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.*,text/csv,text/plain,application/zip

STORAGE_PROVIDER=disk            # disk | s3
STORAGE_DISK_PATH=/data/attachments
S3_ENDPOINT=https://s3.ap-southeast-1.amazonaws.com
S3_BUCKET=bluefish-intake
S3_REGION=ap-southeast-1
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
SIGNED_URL_TTL=300               # วินาที

CLAMAV_HOST=clamav
CLAMAV_PORT=3310
SCAN_MODE=async                  # async | sync
```

---

## 12 · Deployment (Docker)

publicIntake อยู่ในแอป Deskly เดิม — ไม่มี service ใหม่นอกจาก **ClamAV** เพียงเพิ่ม clamav + volumes เข้า `docker-compose` ของ Deskly แล้วรัน `prisma migrate deploy` ตอนบูต

```yaml
services:
  api:     Deskly app (โมดูล publicIntake อยู่ในนี้) · prisma migrate deploy
  db:      postgres:16        # ตรึงเวอร์ชันให้ตรง Deskly
  clamav:  clamav/clamav      # สแกนไวรัส (port 3310)
  adminer / pgadmin           # ดูข้อมูลตอนทดสอบ

volumes:
  attachments:  # ผูกกับ api ที่ /data/attachments (โหมด disk)
  clamav-db:    # ฐานไวรัสของ ClamAV (freshclam อัปเดตเอง)
```

> **บทเรียนเดิม:** ตรึงเวอร์ชัน image (`postgres:16`) อย่าใช้ `postgres:latest` เพื่อเลี่ยงปัญหา version mismatch และตั้ง `DATABASE_URL` ให้ถูกทั้งกรณีในและนอก Docker network

---

## 13 · แผนการทดสอบ

### ทดสอบการเก็บข้อมูล
- [ ] POST ถูกต้อง → `201` + ticketNumber และมีแถวใน `IntakeSubmission`, `Ticket`, `ConsentLog`
- [ ] ไม่ติ๊ก consent → `422` และไม่มีแถวใดถูกเขียน
- [ ] honeypot มีค่า → `201` เลขปลอม, flag `spam`, ไม่ส่งอีเมลผู้แจ้ง
- [ ] ยิงซ้ำเร็ว ๆ เกินเพดาน → `429`
- [ ] ยิง N คำขอพร้อมกัน → เลขที่ตั๋วต้องไม่ซ้ำ (ทดสอบ race)
- [ ] อีเมลฟรี → บันทึกได้ พร้อม flag `isFreeMail = true`

### ทดสอบอีเมล
- [ ] ใช้ Ethereal/Mailtrap → ออก 2 ฉบับ และดู preview ได้
- [ ] `Reply-To` = กล่อง support และ subject มีเลขที่ตั๋ว
- [ ] จำลองการตอบกลับ → email-to-ticket แนบ comment เข้าตั๋วเดิม
- [ ] จำลอง SMTP ล่ม → ตั๋วยังถูกสร้าง, งานส่งเมลเข้า retry

### ทดสอบไฟล์แนบ
- [ ] ไฟล์ > 10 MB ถูกปฏิเสธที่เซิร์ฟเวอร์ (`413`) แม้ client bypass
- [ ] ไฟล์ปลอมนามสกุล (`.exe` เปลี่ยนเป็น `.png`) ถูกจับด้วย magic bytes (`415`)
- [ ] ไฟล์ติดไวรัส (EICAR) → `scanStatus = infected`, ไม่ถูกแนบเข้าตั๋ว, แจ้ง admin
- [ ] ไฟล์สะอาด → `scanStatus = clean`, ผูกเข้าตั๋ว, มีแถวใน `Attachment` + checksum
- [ ] ไฟล์เก็บนอก webroot / bucket ไม่ public — เข้าถึงตรงไม่ได้ ต้องผ่าน pre-signed URL
- [ ] pre-signed URL ที่หมดอายุใช้ไม่ได้

### ตัวอย่าง curl

```bash
# แบบมีไฟล์แนบ (multipart)
curl -i -X POST http://localhost:8080/api/public/tickets \
  -F name="ทดสอบ ระบบ" -F businessEmail="test@company.co.th" \
  -F companyName="Test Co" -F phone="0812345678" \
  -F service="rpa-consult" -F message="ทดสอบแนบไฟล์" \
  -F consent=true -F source="web-intake-form" \
  -F attachments=@./sample.pdf -F attachments=@./photo.jpg

# แบบไม่มีไฟล์ (JSON)
curl -i -X POST http://localhost:8080/api/public/tickets \
  -H "Content-Type: application/json" \
  -d '{"name":"ทดสอบ ระบบ","businessEmail":"test@company.co.th",
       "companyName":"Test Co","phone":"0812345678",
       "service":"rpa-consult","message":"ทดสอบการเก็บข้อมูลและส่งเมล",
       "consent":true,"source":"web-intake-form","website":""}'
```

---

## 14 · หมายเหตุสำหรับ implement (handoff ให้ Claude Code)

โครงโมดูลที่ "เพิ่มเข้าไปใน Deskly" (ไม่ใช่โปรเจกต์ใหม่) — ใช้ของเดิมซ้ำให้มากที่สุด

```
deskly/                          # โปรเจกต์เดิม — เพิ่มโมดูลด้านล่าง
  src/modules/publicIntake/
    routes.ts                    # route group /api/public/* (ไม่ auth)
    middleware.ts                # CORS allowlist + rate-limit + honeypot
    intakeService.ts             # transaction: submission+ticket+consent+attachment
    fileValidate.ts              # ขนาด + magic bytes (allowlist)
    fileScan.ts                  # ClamAV: quarantine → clean/infected
    customerMatch.ts             # จับคู่โดเมนอีเมล → Customer
  src/lib/storage.ts             # StorageProvider: disk | s3 (ใช้ร่วมทั้งแอป)
  # ใช้ซ้ำของเดิม: ticketNumber, mailer, email-to-ticket, prisma client
prisma/schema.prisma             # extend ของเดิม: + Attachment, ฟิลด์ channel/reportedAt
```

**ลำดับสร้าง:** schema → validation → ticketNumber → persistence (transaction) → file (validate → storage → scan) → mailer → route → CORS/rate-limit → tests

### เกณฑ์ผ่าน (acceptance)
- คำขอที่ถูกต้อง 1 รายการ = 1 ตั๋ว `New` + 1 consent log + 2 อีเมล และเลขที่ตั๋วไม่ซ้ำภายใต้ concurrency
- ทุกกรณี error ตอบตาม API contract โดยไม่เขียนข้อมูลค้าง
- อีเมลส่งไม่ออกไม่ทำให้ตั๋วหาย และการตอบกลับผูกเข้าตั๋วเดิมได้
- เก็บ ConsentLog ครบ และมีเส้นทางลบข้อมูล (รวมไฟล์แนบ) ตาม PDPA
- ไฟล์แนบผ่านการตรวจขนาด/ชนิด (magic bytes) + สแกนไวรัสก่อนเข้าถึงได้ และเก็บใน bucket/disk ที่ไม่ public

---

**เชื่อมกับฟอร์ม:** เมื่อ endpoint พร้อม ตั้งค่า `ENDPOINT` ในฟอร์มเป็น URL นี้ ฟอร์มจะเลิกใช้โหมดสาธิตและใช้เลขที่ตั๋วจริงจาก response ทันที

*Bluefish · Intake → Deskly · System Design v0.3 (Draft) · 21 ก.ย. 2026*
