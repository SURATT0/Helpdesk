import { describe, it, expect } from "vitest";
import {
  validateFields,
  isFreeMailDomain,
  phoneDigitsOk,
  checkFile,
  checkFilesBatch,
  buildPayload,
  mockRef,
  mapServerOutcome,
  FILE_LIMITS,
} from "./intake-logic.js";

const VALID = {
  name: "Surat Jaidee",
  email: "surat@company.co.th",
  company: "Example Co., Ltd.",
  phone: "081-234-5678",
  service: "rpa-consult",
  message: "Need help assessing our RPA rollout across three departments.",
  consent: true,
};

describe("validateFields", () => {
  it("accepts a fully valid submission", () => {
    const result = validateFields(VALID);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual({});
  });

  it("rejects a name shorter than 2 characters", () => {
    const result = validateFields({ ...VALID, name: "A" });
    expect(result.ok).toBe(false);
    expect(result.errors.name).toBe("too_short");
  });

  it("rejects an invalid email format", () => {
    const result = validateFields({ ...VALID, email: "not-an-email" });
    expect(result.ok).toBe(false);
    expect(result.errors.email).toBe("invalid_format");
  });

  it("flags a free-mail domain as a warning, never a blocking error", () => {
    const result = validateFields({ ...VALID, email: "surat@gmail.com" });
    expect(result.ok).toBe(true);
    expect(result.errors.email).toBeUndefined();
    expect(result.warnings.email).toBe("free_mail");
  });

  it("rejects a phone with fewer than 9 digits", () => {
    const result = validateFields({ ...VALID, phone: "12345" });
    expect(result.ok).toBe(false);
    expect(result.errors.phone).toBe("invalid_digits");
  });

  it("accepts a phone formatted with dashes and spaces once digits are counted", () => {
    const result = validateFields({ ...VALID, phone: "081 234 5678" });
    expect(result.ok).toBe(true);
  });

  it("requires a service to be selected", () => {
    const result = validateFields({ ...VALID, service: "" });
    expect(result.ok).toBe(false);
    expect(result.errors.service).toBe("required");
  });

  it("rejects a message shorter than 15 characters", () => {
    const result = validateFields({ ...VALID, message: "too short" });
    expect(result.ok).toBe(false);
    expect(result.errors.message).toBe("too_short");
  });

  it("requires consent", () => {
    const result = validateFields({ ...VALID, consent: false });
    expect(result.ok).toBe(false);
    expect(result.errors.consent).toBe("required");
  });
});

describe("isFreeMailDomain / phoneDigitsOk", () => {
  it("recognizes known free-mail domains case-insensitively", () => {
    expect(isFreeMailDomain("Someone@Gmail.com")).toBe(true);
    expect(isFreeMailDomain("someone@company.co.th")).toBe(false);
  });

  it("accepts phone digit counts at the 9 and 15 boundaries", () => {
    expect(phoneDigitsOk("123456789")).toBe(true);
    expect(phoneDigitsOk("123456789012345")).toBe(true);
    expect(phoneDigitsOk("12345678")).toBe(false);
    expect(phoneDigitsOk("1234567890123456")).toBe(false);
  });
});

describe("checkFile / checkFilesBatch", () => {
  it("rejects a file with a disallowed extension even if it claims an allowed MIME type", () => {
    const file = { name: "payload.exe", size: 1024, type: "image/png" };
    const result = checkFile(file, []);
    expect(result).toEqual({ ok: false, reason: "disallowed_type" });
  });

  it("rejects .svg and .html as dangerous, script-capable types", () => {
    expect(checkFile({ name: "logo.svg", size: 100 }, []).reason).toBe("disallowed_type");
    expect(checkFile({ name: "page.html", size: 100 }, []).reason).toBe("disallowed_type");
  });

  it("rejects a file over the per-file size cap", () => {
    const file = { name: "big.pdf", size: FILE_LIMITS.MAX_FILE_BYTES + 1 };
    expect(checkFile(file, [])).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejects a 6th file once 5 are already accepted", () => {
    const existing = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.pdf`, size: 100 }));
    const result = checkFile({ name: "f6.pdf", size: 100 }, existing);
    expect(result).toEqual({ ok: false, reason: "too_many" });
  });

  it("rejects a file that pushes the combined total over 25MB even though each file alone is under the per-file cap", () => {
    const existing = [
      { name: "a.pdf", size: 9 * 1024 * 1024 },
      { name: "b.pdf", size: 9 * 1024 * 1024 },
    ];
    const file = { name: "c.pdf", size: 9 * 1024 * 1024 };
    expect(checkFile(file, existing)).toEqual({ ok: false, reason: "total_too_large" });
  });

  it("rejects an exact duplicate (same name and size) without counting it against the file-count cap", () => {
    const existing = [{ name: "a.pdf", size: 100 }];
    expect(checkFile({ name: "a.pdf", size: 100 }, existing)).toEqual({ ok: false, reason: "duplicate" });
  });

  it("accepts a valid file within all caps", () => {
    expect(checkFile({ name: "photo.jpg", size: 2 * 1024 * 1024 }, [])).toEqual({ ok: true });
  });

  it("checkFilesBatch evaluates later files in the same drop against earlier accepted ones", () => {
    const batch = [
      { name: "a.pdf", size: 9 * 1024 * 1024 },
      { name: "b.pdf", size: 9 * 1024 * 1024 },
      { name: "c.pdf", size: 9 * 1024 * 1024 }, // combined with a+b exceeds 25MB total
    ];
    const { accepted, rejected } = checkFilesBatch(batch, []);
    expect(accepted.map((f) => f.name)).toEqual(["a.pdf", "b.pdf"]);
    expect(rejected).toEqual([{ name: "c.pdf", reason: "total_too_large" }]);
  });
});

describe("buildPayload", () => {
  it("maps client field names to the design doc's payload keys", () => {
    const attachments = [{ name: "a.pdf", size: 100, type: "application/pdf" }];
    const payload = buildPayload({
      name: "  Surat Jaidee  ",
      email: "  Surat@Company.co.th ",
      company: " Example Co ",
      phone: " 081-234-5678 ",
      service: "rpa-consult",
      message: " Need help. ",
      attachments,
      now: new Date("2026-09-21T09:30:00.000Z"),
    });
    expect(payload).toEqual({
      name: "Surat Jaidee",
      businessEmail: "surat@company.co.th",
      companyName: "Example Co",
      phone: "081-234-5678",
      service: "rpa-consult",
      message: "Need help.",
      consent: true,
      source: "web-intake-form",
      attachments: [{ name: "a.pdf", size: 100, type: "application/pdf" }],
      submittedAt: "2026-09-21T09:30:00.000Z",
    });
  });

  it("omits attachment content, sending only name/size/type metadata", () => {
    const payload = buildPayload({
      name: "A",
      email: "a@b.com",
      company: "B",
      phone: "0812345678",
      service: "rpa-consult",
      message: "x",
      attachments: [{ name: "f.pdf", size: 10, type: "application/pdf", lastModified: 123 }],
      now: new Date(),
    });
    expect(Object.keys(payload.attachments[0])).toEqual(["name", "size", "type"]);
  });
});

describe("mockRef", () => {
  it("formats as BF-YYYYMMDD-#### using the given date", () => {
    const ref = mockRef(new Date("2026-09-21T09:30:00.000Z"));
    expect(ref).toMatch(/^BF-20260921-\d{4}$/);
  });
});

describe("mapServerOutcome", () => {
  it("maps 201 to success with the ticket number", () => {
    expect(mapServerOutcome(201, { ticketNumber: "BF-20260921-0042" })).toEqual({
      kind: "success",
      ref: "BF-20260921-0042",
    });
  });

  it("falls back to ref when ticketNumber is absent", () => {
    expect(mapServerOutcome(201, { ref: "BF-20260921-0042" })).toEqual({
      kind: "success",
      ref: "BF-20260921-0042",
    });
  });

  it("maps 400 to validation with the offending field names, never the server's raw text", () => {
    const result = mapServerOutcome(400, { error: "validation", fields: { email: "invalid email format" } });
    expect(result).toEqual({ kind: "validation", fields: ["email"] });
  });

  it("maps 413 to file_too_large with the server-provided max", () => {
    expect(mapServerOutcome(413, { error: "file_too_large", max: "10MB" })).toEqual({
      kind: "file_too_large",
      max: "10MB",
    });
  });

  it("maps 415 to unsupported_type", () => {
    expect(mapServerOutcome(415, { error: "unsupported_type" })).toEqual({ kind: "unsupported_type" });
  });

  it("maps 422 to consent_required", () => {
    expect(mapServerOutcome(422, { error: "consent_required" })).toEqual({ kind: "consent_required" });
  });

  it("maps 429 to rate_limited with retryAfter, defaulting to 60 if missing", () => {
    expect(mapServerOutcome(429, { error: "rate_limited", retryAfter: 42 })).toEqual({
      kind: "rate_limited",
      retryAfter: 42,
    });
    expect(mapServerOutcome(429, { error: "rate_limited" })).toEqual({ kind: "rate_limited", retryAfter: 60 });
  });

  it("maps any other status to server_error", () => {
    expect(mapServerOutcome(500, {})).toEqual({ kind: "server_error" });
    expect(mapServerOutcome(0, null)).toEqual({ kind: "server_error" });
  });
});
