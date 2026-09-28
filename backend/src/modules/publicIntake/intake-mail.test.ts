import { afterEach, describe, expect, it } from "vitest";
import { env } from "../../config/env";
import { renderConfirmation, renderTeamNotify, replyTo } from "./intake-mail";
import type { IntakeMailPayload } from "./intake-mail";

const PAYLOAD: IntakeMailPayload = {
  ticketId: 42,
  ticketNumber: "BF-20260921-0042",
  name: "สุรัตน์ ใจดี",
  businessEmail: "somchai@company.co.th",
  companyName: "บริษัท ตัวอย่าง จำกัด",
  phone: "081-234-5678",
  service: "rpa-consult",
  message: "อยากปรึกษาเรื่องวางระบบ RPA",
  matchedCustomerName: null,
};

describe("renderConfirmation — to the sender", () => {
  it("puts the ticket number and service in the subject, per design doc §07", () => {
    const rendered = renderConfirmation(PAYLOAD);
    expect(rendered.subject).toBe("[BF-20260921-0042] รับเรื่องแล้ว — rpa-consult");
  });

  it("includes the ticket number and message body in the text part", () => {
    const rendered = renderConfirmation(PAYLOAD);
    expect(rendered.text).toContain("BF-20260921-0042");
    expect(rendered.text).toContain(PAYLOAD.message);
  });

  it("HTML-escapes a message containing markup", () => {
    const rendered = renderConfirmation({
      ...PAYLOAD,
      message: "<script>alert(1)</script>",
    });
    expect(rendered.html).not.toContain("<script>alert(1)</script>");
    expect(rendered.html).toContain("&lt;script&gt;");
  });
});

describe("renderTeamNotify — to the desk", () => {
  it("puts the ticket number and company name in the subject", () => {
    const rendered = renderTeamNotify(PAYLOAD);
    expect(rendered.subject).toBe("[BF-20260921-0042] ใหม่ — บริษัท ตัวอย่าง จำกัด");
  });

  it("says explicitly when nothing matched, rather than leaving it blank", () => {
    const rendered = renderTeamNotify(PAYLOAD);
    expect(rendered.text).toContain("ไม่พบ — รอ triage ผูกลูกค้า");
  });

  it("names the matched customer when there is one", () => {
    const rendered = renderTeamNotify({ ...PAYLOAD, matchedCustomerName: "Acme Corp" });
    expect(rendered.text).toContain("Acme Corp");
    expect(rendered.text).not.toContain("ไม่พบ — รอ triage");
  });

  it("carries every submitted field, not a summary of them", () => {
    const rendered = renderTeamNotify(PAYLOAD);
    for (const value of [
      PAYLOAD.name,
      PAYLOAD.businessEmail,
      PAYLOAD.companyName,
      PAYLOAD.phone,
      PAYLOAD.service,
      PAYLOAD.message,
    ]) {
      expect(rendered.text).toContain(value);
    }
  });

  it("links into the Deskly ticket, not a page the sender could use", () => {
    const rendered = renderTeamNotify(PAYLOAD);
    expect(rendered.text).toContain(`/tickets/${PAYLOAD.ticketId}`);
  });
});

describe("replyTo — where a reply threads back to", () => {
  const original = { ...env.publicIntake };
  afterEach(() => {
    env.publicIntake.supportInbox = original.supportInbox;
  });

  it("uses SUPPORT_INBOX when it is set", () => {
    env.publicIntake.supportInbox = "support@bluefishsolution.com";
    expect(replyTo()).toBe("support@bluefishsolution.com");
  });

  it("falls back to the existing agent-reply identity (SMTP_FROM) when unset", () => {
    env.publicIntake.supportInbox = undefined;
    expect(replyTo()).toBe(env.smtp.from ?? "");
  });
});
