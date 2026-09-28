// Pure, DOM-free logic for the public intake form (design doc §05, §08, §09).
// Kept separate from intake-app.js so it can be unit-tested directly under
// vitest (see intake-logic.test.js) without a browser or jsdom — nothing in
// this file touches `window`/`document`.

// ---------- Field limits (mirrors backend/src/modules/publicIntake/intake.validators.ts) ----------
export const FIELD_LIMITS = {
  NAME_MIN: 2,
  NAME_MAX: 200,
  COMPANY_MIN: 2,
  COMPANY_MAX: 200,
  PHONE_MAX: 30,
  PHONE_DIGITS_MIN: 9,
  PHONE_DIGITS_MAX: 15,
  MESSAGE_MIN: 15,
  MESSAGE_MAX: 2000,
};

// Same list the backend validator carries (kept identical on purpose — see
// intake.validators.ts's own comment on why this NEVER blocks a submission,
// only flags one for triage).
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "hotmail.com",
  "hotmail.co.th",
  "yahoo.com",
  "yahoo.co.th",
  "outlook.com",
  "live.com",
  "icloud.com",
  "msn.com",
  "protonmail.com",
]);

export function isFreeMailDomain(email) {
  const domain = String(email).trim().toLowerCase().split("@")[1] ?? "";
  return FREE_MAIL_DOMAINS.has(domain);
}

function isValidEmailFormat(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function phoneDigitsOk(phone) {
  const digits = String(phone).replace(/\D/g, "");
  return digits.length >= FIELD_LIMITS.PHONE_DIGITS_MIN && digits.length <= FIELD_LIMITS.PHONE_DIGITS_MAX;
}

/**
 * Validates the trimmed form values. Returns symbolic reason codes (never
 * localized strings) so the same result can drive either language — see
 * intake-i18n.js for the code -> text mapping.
 *
 * `warnings.email === "free_mail"` is informational only and never makes
 * `ok` false — matching the backend, which flags `isFreeMail` but never
 * rejects on it (design doc §09).
 */
export function validateFields(values) {
  const name = String(values.name ?? "").trim();
  const email = String(values.email ?? "").trim().toLowerCase();
  const company = String(values.company ?? "").trim();
  const phone = String(values.phone ?? "").trim();
  const service = String(values.service ?? "").trim();
  const message = String(values.message ?? "").trim();
  const consent = values.consent === true;

  const errors = {};
  const warnings = {};

  if (name.length < FIELD_LIMITS.NAME_MIN) errors.name = "too_short";
  else if (name.length > FIELD_LIMITS.NAME_MAX) errors.name = "too_long";

  if (!isValidEmailFormat(email)) {
    errors.email = "invalid_format";
  } else if (isFreeMailDomain(email)) {
    warnings.email = "free_mail";
  }

  if (company.length < FIELD_LIMITS.COMPANY_MIN) errors.company = "too_short";
  else if (company.length > FIELD_LIMITS.COMPANY_MAX) errors.company = "too_long";

  if (!phone) errors.phone = "required";
  else if (phone.length > FIELD_LIMITS.PHONE_MAX) errors.phone = "too_long";
  else if (!phoneDigitsOk(phone)) errors.phone = "invalid_digits";

  if (!service) errors.service = "required";

  if (message.length < FIELD_LIMITS.MESSAGE_MIN) errors.message = "too_short";
  else if (message.length > FIELD_LIMITS.MESSAGE_MAX) errors.message = "too_long";

  if (!consent) errors.consent = "required";

  return { ok: Object.keys(errors).length === 0, errors, warnings };
}

// ---------- Attachments (design doc §08.1) ----------
export const FILE_LIMITS = {
  MAX_FILE_BYTES: 10 * 1024 * 1024,
  MAX_FILES: 5,
  MAX_TOTAL_BYTES: 25 * 1024 * 1024,
};

// Allowlist, not a denylist — matches the backend's stance (§08.1: "allowlist
// เท่านั้น") of trusting nothing that isn't explicitly permitted, rather than
// trying to enumerate every dangerous extension.
export const ALLOWED_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "heic",
  "pdf",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "csv", "txt",
  "zip",
]);

function extOf(filename) {
  const dot = String(filename).lastIndexOf(".");
  return dot === -1 ? "" : String(filename).slice(dot + 1).toLowerCase();
}

/**
 * Checks one candidate file against the running batch (`existing`, the files
 * already accepted) and returns why it was rejected, if it was. Never
 * mutates `existing` — the caller decides what to do with an accepted file.
 */
export function checkFile(file, existing) {
  const ext = extOf(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, reason: "disallowed_type" };
  }
  if (file.size > FILE_LIMITS.MAX_FILE_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  if (existing.some((f) => f.name === file.name && f.size === file.size)) {
    return { ok: false, reason: "duplicate" };
  }
  if (existing.length >= FILE_LIMITS.MAX_FILES) {
    return { ok: false, reason: "too_many" };
  }
  const total = existing.reduce((sum, f) => sum + f.size, 0) + file.size;
  if (total > FILE_LIMITS.MAX_TOTAL_BYTES) {
    return { ok: false, reason: "total_too_large" };
  }
  return { ok: true };
}

/**
 * Runs `checkFile` over a batch of newly-picked files against what's already
 * accepted, folding each accepted file into the running list so later files
 * in the SAME batch are checked against it too (matters for count/total caps
 * when several files are dropped at once).
 */
export function checkFilesBatch(newFiles, existingFiles) {
  const accepted = [];
  const rejected = [];
  const running = existingFiles.slice();
  for (const file of Array.from(newFiles)) {
    const result = checkFile(file, running);
    if (result.ok) {
      accepted.push(file);
      running.push(file);
    } else {
      rejected.push({ name: file.name, reason: result.reason });
    }
  }
  return { accepted, rejected };
}

// ---------- Payload (design doc §05) ----------
export function buildPayload({ name, email, company, phone, service, message, attachments, now }) {
  return {
    name: String(name).trim(),
    businessEmail: String(email).trim().toLowerCase(),
    companyName: String(company).trim(),
    phone: String(phone).trim(),
    service,
    message: String(message).trim(),
    consent: true,
    source: "web-intake-form",
    attachments: (attachments ?? []).map((f) => ({
      name: f.name,
      size: f.size,
      type: f.type || "application/octet-stream",
    })),
    submittedAt: (now ?? new Date()).toISOString(),
  };
}

// ---------- Demo-mode ticket reference (design doc §06 — "mockRef() ใช้เฉพาะโหมดสาธิต") ----------
export function mockRef(now = new Date()) {
  const ymd =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
  const rnd = Math.floor(1000 + Math.random() * 9000);
  return "BF-" + ymd + "-" + rnd;
}

// ---------- Server response mapping (design doc §05) ----------
/**
 * Turns an HTTP status + parsed JSON body into a symbolic outcome — never
 * text. The caller (intake-app.js) looks the `kind` up in intake-i18n.js so
 * the message always matches whichever language is active, instead of
 * trusting whatever string shape the server happened to send (design intent:
 * "แปลง error code เป็นข้อความตามภาษาที่เลือกฝั่ง client").
 */
export function mapServerOutcome(status, body) {
  const b = body ?? {};
  if (status === 201) {
    return { kind: "success", ref: b.ticketNumber || b.ref || null };
  }
  if (status === 400) {
    return { kind: "validation", fields: Object.keys(b.fields ?? {}) };
  }
  if (status === 413) {
    return { kind: "file_too_large", max: b.max ?? null };
  }
  if (status === 415) {
    return { kind: "unsupported_type" };
  }
  if (status === 422) {
    return { kind: "consent_required" };
  }
  if (status === 429) {
    return { kind: "rate_limited", retryAfter: Number(b.retryAfter) || 60 };
  }
  return { kind: "server_error" };
}
