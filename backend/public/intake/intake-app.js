// DOM wiring for the public intake form. All actual decisions (validation,
// file checks, payload shape, server-response mapping) live in
// intake-logic.js and are unit-tested there — this file only reads the DOM,
// calls that logic, and writes the DOM back using intake-i18n.js's `t()`.
import {
  validateFields,
  checkFilesBatch,
  buildPayload,
  mockRef,
  mapServerOutcome,
  FIELD_LIMITS,
} from "./intake-logic.js";
import { detectInitialLang, storeLang, makeTranslator } from "./intake-i18n.js";

// ── Endpoint ─────────────────────────────────────────────────────────────
// Relative path: this form is served from the same origin as the API (see
// backend/src/app.ts's `/intake` static mount) — never a full URL here. If
// the form is ever hosted on a different origin, set PUBLIC_FORM_ORIGIN on
// the backend for CORS and change this to a full URL.
// Leaving this empty (falsy) switches the whole form into demo mode: no
// network request is made and every submission gets a client-generated
// mockRef() instead — see design doc §06.
const ENDPOINT = "/api/v1/public/tickets";
const DEMO_MODE = !ENDPOINT;

// ── i18n ─────────────────────────────────────────────────────────────────
let lang = detectInitialLang();
let t = makeTranslator(lang);

const PHONE_HREF = "+6620000000";
const PHONE_LABEL = "02-000-0000";

function applyTranslations() {
  document.documentElement.lang = lang;
  document.title = t("meta.title");

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });

  document.getElementById("name").placeholder = t("field.name.placeholder");
  document.getElementById("email").placeholder = t("field.email.placeholder");
  document.getElementById("company").placeholder = t("field.company.placeholder");
  document.getElementById("phone").placeholder = t("field.phone.placeholder");
  document.getElementById("message").placeholder = t("field.message.placeholder");

  document.getElementById("panelFooter").innerHTML =
    t("panel.footer", { phone: `<a href="tel:${PHONE_HREF}">${PHONE_LABEL}</a>` });

  document.getElementById("lang-th").setAttribute("aria-pressed", String(lang === "th"));
  document.getElementById("lang-en").setAttribute("aria-pressed", String(lang === "en"));

  updateCount();
  renderServiceOptions(currentServiceConfig);
  renderFiles();
  if (!statusOverride) {
    statusEl.textContent = rateLimitTimer ? "" : t("submit.hint.default");
  }
}

function setLang(next) {
  if (next === lang) return;
  lang = next;
  t = makeTranslator(lang);
  storeLang(lang);
  applyTranslations();
}

document.getElementById("lang-th").addEventListener("click", () => setLang("th"));
document.getElementById("lang-en").addEventListener("click", () => setLang("en"));

// ── Demo-mode badge (Acceptance #6: "ไม่ตั้ง ENDPOINT → โหมดสาธิตพร้อมป้ายชัดเจน") ──
const demoBadge = document.getElementById("demoBadge");
if (DEMO_MODE) demoBadge.hidden = false;

// ── Elements ─────────────────────────────────────────────────────────────
const form = document.getElementById("intake");
const formSide = document.getElementById("formSide");
const doneSide = document.getElementById("doneSide");
const btn = document.getElementById("submit");
const statusEl = document.getElementById("status");
const msg = document.getElementById("message");
const countEl = document.getElementById("count");
const consentRow = document.getElementById("consentRow");
const copyRefBtn = document.getElementById("copyRef");

let statusOverride = false; // true while a rate-limit countdown or send-in-progress message owns #status
let rateLimitTimer = null;

function updateCount() {
  countEl.textContent = t("field.message.count", { n: msg.value.length, max: FIELD_LIMITS.MESSAGE_MAX });
}

msg.addEventListener("input", () => {
  if (msg.value.length > FIELD_LIMITS.MESSAGE_MAX) msg.value = msg.value.slice(0, FIELD_LIMITS.MESSAGE_MAX);
  updateCount();
});

// ── Service dropdown (source of truth: backend/config/services.json) ───────
// Fetched relative to this page so it works both served from the backend
// (same origin) and, if ever mirrored, from wherever the JSON is copied
// alongside it. The embedded fallback below is a backup copy only — used
// when the real file fails to load (offline, bad deploy timing) — see
// docs/adding-a-service.md. The dropdown must never end up empty, or no one
// could submit the form at all.
const FALLBACK_SERVICES = [
  { group: "3D — Document Management", order: 1, services: [
    { code: "blue-digital", label: "Blue Digital", desc: "Scan and convert documents into digital files", active: true },
    { code: "blue-document", label: "Blue Document", desc: "Document printing and processing", active: true },
    { code: "blue-develop", label: "Blue Develop", desc: "Design and develop document workflow systems", active: true }
  ]},
  { group: "3S — Computer Media Management", order: 2, services: [
    { code: "blue-swap", label: "Blue Swap", desc: "Media rotation and exchange", active: true },
    { code: "blue-site", label: "Blue Site", desc: "Offsite storage for computer media", active: true },
    { code: "blue-shield", label: "Blue Shield", desc: "Secure media destruction", active: true }
  ]},
  { group: "Box of Fish — Document Storage", order: 3, services: [
    { code: "blue-box", label: "Blue Box", desc: "Box storage with pickup and delivery", active: true },
    { code: "blue-file", label: "Blue File", desc: "Active file storage for records in daily use", active: true },
    { code: "blue-destroys", label: "Blue Destroys", desc: "Secure document destruction", active: true }
  ]},
  { group: "RPA — Robotic Process Automation", order: 4, services: [
    { code: "rpa-license", label: "RPA Enterprise License", desc: "Licensing for software robots", active: true },
    { code: "rpa-consult", label: "RPA Consulting", desc: "Process assessment and rollout planning", active: true },
    { code: "rpa-implement", label: "Bot Development & Support", desc: "Build, test and maintain your bots", active: true }
  ]}
];

const serviceSelect = document.getElementById("service");
let currentServiceConfig = null;

function renderServiceOptions(config) {
  if (!config) return;
  const selected = serviceSelect.value;
  while (serviceSelect.options.length) serviceSelect.remove(0);

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.disabled = true;
  placeholder.textContent = t("field.service.placeholder");
  // `defaultSelected` (which reflects the `selected` CONTENT ATTRIBUTE), not
  // just the `.selected` property — native `form.reset()` restores whichever
  // option has this set, and falls back to the first option in the list
  // otherwise. Without it, "Submit another request" silently left the first
  // real service pre-selected instead of the placeholder.
  placeholder.defaultSelected = true;
  serviceSelect.appendChild(placeholder);

  config.slice().sort((a, b) => a.order - b.order).forEach((group) => {
    const active = group.services.filter((s) => s.active);
    if (!active.length) return;
    const og = document.createElement("optgroup");
    og.label = group.group;
    active.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.code;
      opt.textContent = s.label + " — " + s.desc;
      og.appendChild(opt);
    });
    serviceSelect.appendChild(og);
  });

  const other = document.createElement("option");
  other.value = "other";
  other.textContent = t("field.service.other");
  serviceSelect.appendChild(other);

  if (selected && [...serviceSelect.options].some((o) => o.value === selected)) {
    serviceSelect.value = selected;
  } else {
    placeholder.selected = true;
  }
}

function setServiceLoading(loading) {
  serviceSelect.disabled = loading;
  btn.disabled = loading;
  if (loading) {
    while (serviceSelect.options.length) serviceSelect.remove(0);
    const opt = document.createElement("option");
    opt.value = "";
    opt.selected = true;
    opt.disabled = true;
    opt.textContent = t("field.service.loading");
    serviceSelect.appendChild(opt);
  }
}

setServiceLoading(true);
fetch("./config/services.json")
  .then((res) => {
    if (!res.ok) throw new Error("bad status " + res.status);
    return res.json();
  })
  .then((config) => {
    currentServiceConfig = config;
  })
  .catch(() => {
    currentServiceConfig = FALLBACK_SERVICES;
  })
  .finally(() => {
    setServiceLoading(false);
    renderServiceOptions(currentServiceConfig);
  });

// ── Attachments ──────────────────────────────────────────────────────────
const fileInput = document.getElementById("files");
const drop = document.getElementById("drop");
const fileList = document.getElementById("filelist");
const errFiles = document.getElementById("err-files");
let attachments = [];

function fmtSize(b) {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return Math.round(b / 1024) + " KB";
  return (b / 1024 / 1024).toFixed(1) + " MB";
}

function renderFiles() {
  fileList.innerHTML = "";
  attachments.forEach((f, i) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "fi-name";
    name.textContent = f.name;
    const size = document.createElement("span");
    size.className = "fi-size";
    size.textContent = fmtSize(f.size);
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "fi-remove";
    rm.setAttribute("aria-label", t("field.files.remove", { name: f.name }));
    rm.textContent = "×";
    rm.addEventListener("click", () => {
      attachments.splice(i, 1);
      renderFiles();
    });
    li.append(name, size, rm);
    fileList.appendChild(li);
  });
}

function addFiles(list) {
  const { accepted, rejected } = checkFilesBatch(list, attachments);
  attachments = attachments.concat(accepted);
  errFiles.textContent = rejected.length
    ? rejected.map((r) => t(`err.file.${r.reason}`, { name: r.name })).join(" · ")
    : "";
  renderFiles();
}

drop.addEventListener("click", (e) => {
  if (e.target === fileInput) return;
  fileInput.click();
});
fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = "";
});
["dragenter", "dragover"].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add("drag");
  }),
);
drop.addEventListener("dragleave", (e) => {
  if (!drop.contains(e.relatedTarget)) drop.classList.remove("drag");
});
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("drag");
  if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
});

// ── Client-side validation display ──────────────────────────────────────
function setFieldError(field, key) {
  const el = document.getElementById(field);
  const box = document.getElementById("err-" + field);
  const text = key ? t(`err.${field}.${key}`) : "";
  box.textContent = text;
  if (text) el.setAttribute("aria-invalid", "true");
  else el.removeAttribute("aria-invalid");
}

function runClientValidation() {
  const values = {
    name: document.getElementById("name").value,
    email: document.getElementById("email").value,
    company: document.getElementById("company").value,
    phone: document.getElementById("phone").value,
    service: document.getElementById("service").value,
    message: document.getElementById("message").value,
    consent: document.getElementById("consent").checked,
  };
  const { ok, errors, warnings } = validateFields(values);

  ["name", "email", "company", "phone", "service", "message"].forEach((field) => {
    setFieldError(field, errors[field] ?? null);
  });

  document.getElementById("warn-email").textContent = warnings.email ? t(`warn.email.${warnings.email}`) : "";

  const consentInvalid = Boolean(errors.consent);
  document.getElementById("err-consent").textContent = consentInvalid ? t("err.consent.required") : "";
  document.getElementById("consent").setAttribute("aria-invalid", consentInvalid ? "true" : "false");
  consentRow.classList.toggle("invalid", consentInvalid);

  if (!ok) {
    const first = form.querySelector('[aria-invalid="true"]');
    if (first) first.focus();
  }
  return { ok, values };
}

// ── Rate-limit countdown (Acceptance #4: 429 disables submit until retryAfter elapses) ──
function startRateLimitCountdown(seconds) {
  clearRateLimitCountdown();
  let remaining = seconds;
  statusOverride = true;
  btn.disabled = true;
  statusEl.textContent = t("submit.hint.rateLimited", { s: remaining });
  rateLimitTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearRateLimitCountdown();
      return;
    }
    statusEl.textContent = t("submit.hint.rateLimited", { s: remaining });
  }, 1000);
}

function clearRateLimitCountdown() {
  if (rateLimitTimer) {
    clearInterval(rateLimitTimer);
    rateLimitTimer = null;
  }
  statusOverride = false;
  btn.disabled = false;
  statusEl.textContent = t("submit.hint.default");
}

// ── Server outcome handling (design doc §05 response table) ─────────────
function applyServerOutcome(outcome) {
  switch (outcome.kind) {
    case "validation":
      outcome.fields.forEach((field) => {
        const box = document.getElementById("err-" + field);
        if (box) {
          box.textContent = t("err.field.server");
          const el = document.getElementById(field);
          if (el) el.setAttribute("aria-invalid", "true");
        }
      });
      statusEl.textContent = t("outcome.validation");
      btn.disabled = false;
      return;
    case "file_too_large":
      errFiles.textContent = t("outcome.file_too_large", { max: outcome.max ?? "" });
      statusEl.textContent = "";
      btn.disabled = false;
      return;
    case "unsupported_type":
      errFiles.textContent = t("outcome.unsupported_type");
      statusEl.textContent = "";
      btn.disabled = false;
      return;
    case "consent_required":
      document.getElementById("err-consent").textContent = t("outcome.consent_required");
      consentRow.classList.add("invalid");
      statusEl.textContent = "";
      btn.disabled = false;
      return;
    case "rate_limited":
      startRateLimitCountdown(outcome.retryAfter);
      return;
    case "network_error":
      statusEl.textContent = t("outcome.network_error");
      btn.disabled = false;
      return;
    case "server_error":
    default:
      statusEl.textContent = t("outcome.server_error");
      btn.disabled = false;
      return;
  }
}

// ── Submit ────────────────────────────────────────────────────────────────
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (document.getElementById("website").value) return; // honeypot — never submits, matching the server's own silent-accept behavior

  const { ok, values } = runClientValidation();
  if (!ok) return;

  const payload = buildPayload({ ...values, attachments });

  btn.disabled = true;
  statusOverride = true;
  statusEl.textContent = t("submit.sending");

  let outcome;
  if (DEMO_MODE) {
    await new Promise((r) => setTimeout(r, 700));
    outcome = { kind: "success", ref: mockRef() };
  } else {
    try {
      let res;
      if (attachments.length) {
        const fd = new FormData();
        Object.keys(payload).forEach((k) => {
          if (k === "attachments") return; // real files are appended below; this key is metadata-only
          fd.append(k, typeof payload[k] === "object" ? JSON.stringify(payload[k]) : payload[k]);
        });
        attachments.forEach((f) => fd.append("attachments", f, f.name));
        res = await fetch(ENDPOINT, { method: "POST", body: fd });
      } else {
        res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      const body = await res.json().catch(() => ({}));
      outcome = mapServerOutcome(res.status, body);
    } catch {
      outcome = { kind: "network_error" };
    }
  }

  statusOverride = false;

  if (outcome.kind !== "success") {
    applyServerOutcome(outcome);
    return;
  }

  const ref = outcome.ref || mockRef();
  document.getElementById("ticketRef").textContent = ref;
  copyRefBtn.textContent = t("done.copy");
  copyRefBtn.classList.remove("copied");
  document.getElementById("doneLede").textContent = t("done.lede", { email: payload.businessEmail });
  document.getElementById("payload").textContent = JSON.stringify(payload, null, 2);
  formSide.classList.add("off");
  doneSide.classList.add("on");
  doneSide.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

// ── Reset after success ──────────────────────────────────────────────────
// No prior form state is kept: `form.reset()` clears every field, and
// `attachments` (held only in this module's memory, never localStorage/
// sessionStorage) is emptied too — so neither a fresh submission nor a
// bfcache-restored view of this page can show stale data.
function resetForm() {
  clearRateLimitCountdown();
  form.reset();
  updateCount();
  attachments = [];
  renderFiles();
  form.querySelectorAll(".err, .warn").forEach((el) => (el.textContent = ""));
  form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  consentRow.classList.remove("invalid");
  btn.disabled = false;
  statusEl.textContent = t("submit.hint.default");
  doneSide.classList.remove("on");
  formSide.classList.remove("off");
  document.getElementById("name").focus();
}

document.getElementById("again").addEventListener("click", resetForm);

copyRefBtn.addEventListener("click", async () => {
  const ref = document.getElementById("ticketRef").textContent;
  try {
    await navigator.clipboard.writeText(ref);
  } catch {
    // Clipboard API unavailable (older browser, no permission) — the ticket
    // number is still plain selectable text, so the user can copy it by hand.
    return;
  }
  copyRefBtn.textContent = t("done.copied");
  copyRefBtn.classList.add("copied");
  setTimeout(() => {
    copyRefBtn.textContent = t("done.copy");
    copyRefBtn.classList.remove("copied");
  }, 1600);
});

// A page restored from bfcache (browser back/forward) must never show a
// stale success screen with someone else's — or an old — ticket number.
window.addEventListener("pageshow", (e) => {
  if (e.persisted && doneSide.classList.contains("on")) resetForm();
});

// ── Initial paint ─────────────────────────────────────────────────────────
applyTranslations();
document.body.style.visibility = "visible";
