// TH/EN copy for the public intake form. Built from scratch for this page —
// see the survey note in the accompanying task: there was no prior TH/EN
// toggle on this static form to carry forward.
//
// Every user-facing string lives here, keyed by a dot path, so intake-app.js
// never has to choose text itself — it only picks the KEY (from validation/
// file-check/server-outcome reason codes) and looks it up in whichever
// dictionary is active.

export const LANG_STORAGE_KEY = "bf-intake-lang";

const TH = {
  "meta.title": "แจ้งเรื่อง Bluefish",
  "lang.toggle.th": "ไทย",
  "lang.toggle.en": "EN",

  "panel.h1": "แจ้งปัญหาหรือขอรับบริการ",
  "panel.lede": "กรอกข้อมูลเบื้องต้น ระบบจะเปิดตั๋วในระบบ Helpdesk และส่งเลขที่ตั๋วกลับไปที่อีเมลของคุณ",
  "panel.flow.1.title": "ส่งเรื่อง",
  "panel.flow.1.desc": "ได้เลขที่ตั๋วทันทีทางอีเมล",
  "panel.flow.2.title": "ทีมรับเรื่อง",
  "panel.flow.2.desc": "ตรวจสอบและจัดลำดับความสำคัญ ภายใน 1 วันทำการ",
  "panel.flow.3.title": "ดำเนินการ",
  "panel.flow.3.desc": "ติดตามสถานะและตอบกลับผ่านอีเมลเดิมได้ตลอด",
  "panel.footer": "เรื่องด่วนที่กระทบการทำงาน โทร {phone} (จันทร์–ศุกร์ 9:00–18:00)",

  "form.h2": "ข้อมูลผู้แจ้ง",
  "form.lede": "ช่องที่มีเครื่องหมาย * จำเป็นต้องกรอก",

  "field.name.label": "ชื่อ-นามสกุล *",
  "field.name.placeholder": "สุรัตน์ ใจดี",
  "field.email.label": "อีเมลบริษัท *",
  "field.email.placeholder": "you@company.co.th",
  "field.company.label": "ชื่อบริษัท *",
  "field.company.placeholder": "บริษัท ตัวอย่าง จำกัด",
  "field.phone.label": "เบอร์ติดต่อกลับ *",
  "field.phone.placeholder": "081-234-5678 หรือ 02-000-0000 ต่อ 123",
  "field.service.label": "บริการที่ต้องการ *",
  "field.service.loading": "กำลังโหลดรายการบริการ…",
  "field.service.placeholder": "เลือกบริการ",
  "field.service.other": "อื่น ๆ — ไม่อยู่ในรายการด้านบน",
  "field.message.label": "รายละเอียดปัญหาหรือสิ่งที่ต้องการ *",
  "field.message.placeholder":
    "เล่าสั้น ๆ ว่าเกิดอะไรขึ้น เริ่มเมื่อไร ระบบหรือกระบวนการไหนที่ได้รับผลกระทบ และมีข้อความแจ้งเตือนอะไรขึ้นมาบ้าง",
  "field.message.count": "{n} / {max}",
  "field.files.label": "แนบรูปหรือไฟล์",
  "field.files.optional": "(ไม่บังคับ · สูงสุด 10 MB ต่อไฟล์)",
  "field.files.browse": "เลือกไฟล์…",
  "field.files.hint": "หรือลากไฟล์มาวางที่นี่ · รองรับรูปภาพ, PDF, Word, Excel, ZIP",
  "field.files.remove": "ลบไฟล์ {name}",
  "field.consent.label": "ยินยอมให้ Bluefish เก็บและใช้ข้อมูลนี้เพื่อติดต่อกลับและดำเนินการตามคำขอ",
  "field.consent.pdpa": "(ตาม PDPA)",

  "err.name.too_short": "กรอกชื่อ-นามสกุลของผู้แจ้ง",
  "err.name.too_long": "ชื่อยาวเกินไป",
  "err.email.invalid_format": "รูปแบบอีเมลไม่ถูกต้อง",
  "warn.email.free_mail": "ดูเหมือนนี่เป็นอีเมลส่วนตัว ใช้อีเมลของบริษัทจะช่วยให้เราจับคู่กับสัญญาบริการได้เร็วขึ้น",
  "err.company.too_short": "กรอกชื่อบริษัทหรือหน่วยงาน",
  "err.company.too_long": "ชื่อบริษัทยาวเกินไป",
  "err.phone.required": "กรอกเบอร์ติดต่อกลับ",
  "err.phone.too_long": "เบอร์ติดต่อกลับยาวเกินไป",
  "err.phone.invalid_digits": "ตรวจสอบเบอร์อีกครั้ง เช่น 081-234-5678 หรือ 02-000-0000 ต่อ 123",
  "err.service.required": "เลือกบริการที่ต้องการ",
  "err.message.too_short": "อธิบายเพิ่มอีกนิด อย่างน้อย 15 ตัวอักษร เพื่อให้ทีมงานเข้าใจปัญหา",
  "err.message.too_long": "รายละเอียดยาวเกินไป (สูงสุด 2000 ตัวอักษร)",
  "err.consent.required": "ต้องยินยอมก่อนส่งเรื่อง",
  "err.field.server": "เซิร์ฟเวอร์ตรวจพบว่าข้อมูลในช่องนี้ไม่ถูกต้อง โปรดตรวจสอบอีกครั้ง",

  "err.file.too_large": "{name} — ไฟล์ใหญ่เกิน 10 MB",
  "err.file.too_many": "{name} — แนบได้ไม่เกิน 5 ไฟล์",
  "err.file.total_too_large": "{name} — ไฟล์รวมทั้งหมดต้องไม่เกิน 25 MB",
  "err.file.disallowed_type": "{name} — ไม่รองรับชนิดไฟล์นี้",
  "err.file.duplicate": "{name} — แนบไฟล์นี้ไปแล้ว",

  "submit.button": "ส่งเรื่อง",
  "submit.sending": "กำลังส่ง…",
  "submit.hint.default": "ระบบจะตอบกลับเลขที่ตั๋วภายในไม่กี่นาที",
  "submit.hint.rateLimited": "ส่งถี่เกินไป กรุณารออีก {s} วินาที",

  "outcome.validation": "กรุณาตรวจสอบข้อมูลที่กรอกอีกครั้ง",
  "outcome.file_too_large": "ไฟล์ใหญ่เกิน {max}",
  "outcome.unsupported_type": "ไม่รองรับชนิดไฟล์นี้",
  "outcome.consent_required": "ต้องยินยอมก่อนส่งเรื่อง",
  "outcome.server_error": "ส่งไม่สำเร็จ ลองอีกครั้ง หรือส่งอีเมลมาที่ support@bluefishsolution.com",
  "outcome.network_error": "เชื่อมต่อไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง",

  "demo.badge": "โหมดทดสอบ — ยังไม่เชื่อมระบบจริง",

  "done.h2": "รับเรื่องเรียบร้อย",
  "done.lede": "เราส่งรายละเอียดไปที่ {email} แล้ว เลขที่ตั๋วของคุณคือ",
  "done.bullet1": "ตอบกลับอีเมลฉบับนี้เพื่อเพิ่มรายละเอียดหรือแนบไฟล์ได้ทันที",
  "done.bullet2": "ทีมงานจะติดต่อกลับภายใน 1 วันทำการ",
  "done.copy": "คัดลอก",
  "done.copied": "คัดลอกแล้ว",
  "done.payloadSummary": "ข้อมูลที่ส่งเข้าระบบ (สำหรับผู้ดูแล)",
  "done.again": "แจ้งเรื่องใหม่",
};

const EN = {
  "meta.title": "Contact Bluefish",
  "lang.toggle.th": "TH",
  "lang.toggle.en": "EN",

  "panel.h1": "Report an issue or request a service",
  "panel.lede": "Fill in a few details and we'll open a ticket in our Helpdesk and email you the ticket number.",
  "panel.flow.1.title": "Submit",
  "panel.flow.1.desc": "Get a ticket number by email right away",
  "panel.flow.2.title": "Team review",
  "panel.flow.2.desc": "Checked and prioritized within 1 business day",
  "panel.flow.3.title": "In progress",
  "panel.flow.3.desc": "Track status and reply through the same email thread",
  "panel.footer": "For anything affecting your operations right now, call {phone} (Mon–Fri 9:00–18:00)",

  "form.h2": "Your information",
  "form.lede": "Fields marked * are required",

  "field.name.label": "Full name *",
  "field.name.placeholder": "Jane Doe",
  "field.email.label": "Business email *",
  "field.email.placeholder": "you@company.com",
  "field.company.label": "Company name *",
  "field.company.placeholder": "Example Co., Ltd.",
  "field.phone.label": "Contact phone *",
  "field.phone.placeholder": "081-234-5678 or 02-000-0000 ext. 123",
  "field.service.label": "Service needed *",
  "field.service.loading": "Loading services…",
  "field.service.placeholder": "Select a service",
  "field.service.other": "Other — not listed above",
  "field.message.label": "Describe the issue or request *",
  "field.message.placeholder":
    "Briefly describe what happened, when it started, which system or process is affected, and any error messages you saw.",
  "field.message.count": "{n} / {max}",
  "field.files.label": "Attach photos or files",
  "field.files.optional": "(optional · up to 10 MB each)",
  "field.files.browse": "Choose files…",
  "field.files.hint": "or drag and drop here · images, PDF, Word, Excel, ZIP",
  "field.files.remove": "Remove {name}",
  "field.consent.label": "I consent to Bluefish collecting and using this information to follow up and process my request",
  "field.consent.pdpa": "(per Thailand's PDPA)",

  "err.name.too_short": "Please enter your full name",
  "err.name.too_long": "Name is too long",
  "err.email.invalid_format": "Please enter a valid email address",
  "warn.email.free_mail": "This looks like a personal inbox — using your company email helps us match you to your service contract faster.",
  "err.company.too_short": "Please enter your company or organization name",
  "err.company.too_long": "Company name is too long",
  "err.phone.required": "Please enter a contact phone number",
  "err.phone.too_long": "Phone number is too long",
  "err.phone.invalid_digits": "Please double-check the number, e.g. 081-234-5678 or 02-000-0000 ext. 123",
  "err.service.required": "Please select a service",
  "err.message.too_short": "Please add a bit more detail — at least 15 characters — so the team understands the issue",
  "err.message.too_long": "Description is too long (2000 characters max)",
  "err.consent.required": "You must consent before submitting",
  "err.field.server": "The server found this field invalid — please check it again",

  "err.file.too_large": "{name} — file is over 10 MB",
  "err.file.too_many": "{name} — up to 5 files can be attached",
  "err.file.total_too_large": "{name} — combined attachments must stay under 25 MB",
  "err.file.disallowed_type": "{name} — this file type isn't supported",
  "err.file.duplicate": "{name} — already attached",

  "submit.button": "Submit",
  "submit.sending": "Sending…",
  "submit.hint.default": "We'll reply with a ticket number within a few minutes",
  "submit.hint.rateLimited": "You're submitting too quickly. Please wait {s}s and try again",

  "outcome.validation": "Please check the highlighted fields",
  "outcome.file_too_large": "File is over {max}",
  "outcome.unsupported_type": "This file type isn't supported",
  "outcome.consent_required": "You must consent before submitting",
  "outcome.server_error": "Something went wrong. Please try again, or email support@bluefishsolution.com",
  "outcome.network_error": "Couldn't connect. Check your internet connection and try again",

  "demo.badge": "Demo mode — not connected to a real system",

  "done.h2": "Request received",
  "done.lede": "We've sent the details to {email}. Your ticket number is",
  "done.bullet1": "Reply to that email any time to add details or attachments",
  "done.bullet2": "Our team will follow up within 1 business day",
  "done.copy": "Copy",
  "done.copied": "Copied",
  "done.payloadSummary": "Data submitted (for admin reference)",
  "done.again": "Submit another request",
};

const DICTIONARIES = { th: TH, en: EN };

export function detectInitialLang() {
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (stored === "th" || stored === "en") return stored;
  } catch {
    // localStorage unavailable (private mode, disabled) — fall through to default.
  }
  return "th";
}

export function storeLang(lang) {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // Best-effort only — the page still works without persistence.
  }
}

/** `t("key", {placeholder: value})` — substitutes `{placeholder}` tokens; missing keys return the key itself so a typo is visible instead of silently blank. */
export function makeTranslator(lang) {
  const dict = DICTIONARIES[lang] ?? DICTIONARIES.th;
  return function t(key, params) {
    let text = dict[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replaceAll(`{${k}}`, String(v));
      }
    }
    return text;
  };
}
