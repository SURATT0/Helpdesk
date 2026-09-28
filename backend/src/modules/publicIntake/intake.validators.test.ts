import { describe, expect, it } from "vitest";
import { validateIntakeFields } from "./intake.validators";

const VALID: Record<string, unknown> = {
  name: "สุรัตน์ ใจดี",
  businessEmail: "somchai@company.co.th",
  companyName: "บริษัท ตัวอย่าง จำกัด",
  phone: "081-234-5678",
  service: "rpa-consult",
  message: "อยากปรึกษาเรื่องวางระบบ RPA ให้ทีมงานติดต่อกลับด้วยครับ",
  consent: true,
  source: "web-intake-form",
  submittedAt: "2026-09-21T09:30:00.000Z",
};

describe("consent — the one gate that must stop before any row is written", () => {
  it("refuses a missing consent with its own reason, not a field error", () => {
    const { consent: _drop, ...withoutConsent } = VALID;
    const result = validateIntakeFields(withoutConsent);
    expect(result).toEqual({ ok: false, reason: "consent" });
  });

  it("refuses consent: false the same way", () => {
    const result = validateIntakeFields({ ...VALID, consent: false });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("consent");
  });

  it("accepts consent as the multipart-stringified \"true\"", () => {
    // FormData.append('consent', true) arrives server-side as the string
    // "true", not a boolean — the multipart path must treat it as granted.
    const result = validateIntakeFields({ ...VALID, consent: "true" });
    expect(result.ok).toBe(true);
  });

  it("refuses the multipart-stringified \"false\"", () => {
    const result = validateIntakeFields({ ...VALID, consent: "false" });
    expect(result).toEqual({ ok: false, reason: "consent" });
  });
});

describe("field rules mirror the client's own validate(), not looser", () => {
  it("accepts a fully valid submission", () => {
    const result = validateIntakeFields(VALID);
    expect(result.ok).toBe(true);
  });

  it("rejects a name under 2 characters", () => {
    const result = validateIntakeFields({ ...VALID, name: "A" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("fields");
    expect(result.ok === false && result.reason === "fields" && result.fields.name).toBeDefined();
  });

  it("rejects a malformed email", () => {
    const result = validateIntakeFields({ ...VALID, businessEmail: "not-an-email" });
    expect(result.ok === false && result.reason === "fields" && result.fields.businessEmail).toBeDefined();
  });

  it("rejects a phone with fewer than 9 digits", () => {
    const result = validateIntakeFields({ ...VALID, phone: "12345" });
    expect(result.ok === false && result.reason === "fields" && result.fields.phone).toBeDefined();
  });

  it("rejects a phone with more than 15 digits", () => {
    const result = validateIntakeFields({ ...VALID, phone: "1".repeat(16) });
    expect(result.ok === false && result.reason === "fields" && result.fields.phone).toBeDefined();
  });

  it("rejects a message under 15 characters", () => {
    const result = validateIntakeFields({ ...VALID, message: "too short" });
    expect(result.ok === false && result.reason === "fields" && result.fields.message).toBeDefined();
  });

  it("rejects a message over the 2000-character cap the client also enforces", () => {
    const result = validateIntakeFields({ ...VALID, message: "a".repeat(2001) });
    expect(result.ok === false && result.reason === "fields" && result.fields.message).toBeDefined();
  });

  it("rejects an empty service", () => {
    const result = validateIntakeFields({ ...VALID, service: "" });
    expect(result.ok === false && result.reason === "fields" && result.fields.service).toBeDefined();
  });

  it("does not require the honeypot field at all", () => {
    // The real client never sends `website` when it's empty (see the phase-1
    // compatibility review) — a schema that required it would reject every
    // ordinary submission.
    const result = validateIntakeFields(VALID);
    expect(result.ok).toBe(true);
  });

  it("accepts an unrecognised service code — the catalog is a product decision, not a schema one", () => {
    const result = validateIntakeFields({ ...VALID, service: "some-future-service" });
    expect(result.ok).toBe(true);
  });
});

describe("free mail — flagged, never refused (§09; overrides the client's own hard block)", () => {
  it("flags a gmail.com sender as isFreeMail and still accepts the submission", () => {
    const result = validateIntakeFields({ ...VALID, businessEmail: "person@gmail.com" });
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.isFreeMail).toBe(true);
  });

  it("does not flag a company domain", () => {
    const result = validateIntakeFields(VALID);
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.isFreeMail).toBe(false);
  });

  it("is case-insensitive on the domain", () => {
    const result = validateIntakeFields({ ...VALID, businessEmail: "Person@GMAIL.com" });
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.isFreeMail).toBe(true);
  });
});

describe("attachments metadata from the JSON-only path is ignored, not rejected", () => {
  it("accepts a submission carrying the client's empty attachments array", () => {
    // The real form always includes `attachments: []` in the JSON body, even
    // with no files (see the phase-1 compatibility review) — real files never
    // travel through this shape.
    const result = validateIntakeFields({ ...VALID, attachments: [] });
    expect(result.ok).toBe(true);
  });
});
