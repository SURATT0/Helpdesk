import { describe, expect, it } from "vitest";
import { missingKeys } from "../../shared/i18n";
import { EMAIL_EVENTS } from "./email.events";
import type { RequesterPayload, StaffPayload } from "./email.events";
import { buildSubject, renderEmail, truncate, SUBJECT_MAX } from "./email.templates";

const OPTS = { webOrigin: "https://desk.example.com" };

const ticket = {
  id: 1046,
  subject: "Printer on the 3rd floor keeps jamming",
  displayStatus: "in_progress" as const,
  priority: "high" as const,
  category: "Hardware",
  requesterName: "Dana Reyes",
  assigneeName: "Jo Patel",
};

const requesterPayload: RequesterPayload = {
  audience: "requester",
  ticket,
  occurredAt: "2026-09-03T07:32:00.000Z",
  message: { authorName: "Jo Patel", body: "We swapped the fuser unit." },
  vars: { recipientName: "Dana Reyes", author: "Jo Patel" },
};

const staffPayload: StaffPayload = {
  audience: "staff",
  ticket,
  occurredAt: "2026-09-03T07:32:00.000Z",
  message: { authorName: "Dana Reyes", body: "Still jamming this morning." },
  vars: { recipientName: "Jo Patel", author: "Dana Reyes" },
  problem: { id: 7, title: "Fuser batch B12 defective" },
};

describe("subject line", () => {
  it("carries the branded ticket tag every mail must have", () => {
    expect(buildSubject(1046, "Printer jam")).toBe("[Deskly #1046] Printer jam");
  });

  it("truncates a long subject with an ellipsis, tag intact", () => {
    const long = "x".repeat(200);
    const subject = buildSubject(1046, long);
    expect(subject.startsWith("[Deskly #1046] ")).toBe(true);
    expect([...subject.replace("[Deskly #1046] ", "")]).toHaveLength(SUBJECT_MAX);
    expect(subject.endsWith("…")).toBe(true);
  });

  it("leaves a subject at the limit alone", () => {
    const exact = "y".repeat(SUBJECT_MAX);
    expect(truncate(exact, SUBJECT_MAX)).toBe(exact);
  });

  // `.length` counts UTF-16 units, so an emoji would silently cost two and a
  // naive slice could cut a surrogate pair in half.
  it("counts characters, not UTF-16 code units", () => {
    const emoji = "🖨".repeat(80);
    expect([...truncate(emoji, 10)]).toHaveLength(10);
    expect(truncate(emoji, 10)).not.toContain("�");
  });

  it("is identical for every event on one ticket, which is what threads them", () => {
    const subjects = new Set(
      EMAIL_EVENTS.map(
        (e) => renderEmail(e, requesterPayload, "en", OPTS).subject,
      ),
    );
    expect(subjects.size).toBe(1);
  });
});

describe("body contents", () => {
  const { text, html } = renderEmail(
    "comment.public_reply",
    requesterPayload,
    "en",
    OPTS,
  );

  it("is sent as both plain text and HTML, never HTML alone", () => {
    expect(text.length).toBeGreaterThan(0);
    expect(html).toContain("<div");
  });

  it("carries every fact the spec requires", () => {
    expect(text).toContain("#1046");
    expect(text).toContain("Printer on the 3rd floor keeps jamming");
    expect(text).toContain("In Progress");
    expect(text).toContain("High");
    expect(text).toContain("Hardware");
    expect(text).toContain("Dana Reyes");
    expect(text).toContain("Jo Patel");
  });

  it("shows the DISPLAY status, never the stored one", () => {
    // `in_progress` is not a value tickets.status can hold; rendering the raw
    // column would tell a requester "new" while somebody is working on it.
    expect(text).toContain("In Progress");
    expect(text).not.toContain("in_progress");
  });

  it("links to the ticket and names the timezone", () => {
    expect(text).toContain("https://desk.example.com/tickets/1046");
    expect(text).toContain("Asia/Bangkok");
  });

  it("sends the latest message only, not the whole thread", () => {
    expect(text).toContain("We swapped the fuser unit.");
    expect(text).not.toContain("Still jamming this morning.");
  });

  it("says Unassigned rather than leaving the assignee blank", () => {
    const { text: t2 } = renderEmail(
      "ticket.created",
      { ...requesterPayload, ticket: { ...ticket, assigneeName: null } },
      "en",
      OPTS,
    );
    expect(t2).toContain("Unassigned");
  });
});

describe("what a requester is never told", () => {
  // The requester payload TYPE has no `problem` field, so this is structural
  // rather than a filter — there is nothing to strip. The test pins it anyway:
  // a future widening of the type would have to break this to land.
  it("carries no linked problem, even when the ticket has one", () => {
    const { text, html } = renderEmail(
      "comment.public_reply",
      requesterPayload,
      "en",
      OPTS,
    );
    expect(text).not.toContain("Fuser batch B12 defective");
    expect(html).not.toContain("Fuser batch B12 defective");
  });

  it("carries no internal note body", () => {
    const { text } = renderEmail("ticket.pending", requesterPayload, "en", OPTS);
    expect(text).not.toContain("Still jamming this morning.");
  });

  // Workload figures are restricted to super admins in the app; nothing in a
  // mail payload can carry them, and no template asks for them.
  it("has no field that could carry per-agent workload", () => {
    const serialised = JSON.stringify(requesterPayload);
    expect(serialised).not.toMatch(/workload|openCount|assignedCount/i);
  });
});

describe("the pending mail is what makes closure two-sided", () => {
  const { text, html } = renderEmail(
    "ticket.pending",
    requesterPayload,
    "en",
    OPTS,
  );

  it("offers both a confirm and a reopen link", () => {
    expect(text).toContain("/tickets/1046?closure=confirm");
    expect(text).toContain("/tickets/1046?closure=reject");
    expect(html).toContain("closure=confirm");
  });
});

describe("language", () => {
  it("writes Thai to a Thai reader and English to an English one", () => {
    const th = renderEmail("comment.public_reply", requesterPayload, "th", OPTS);
    const en = renderEmail("comment.public_reply", requesterPayload, "en", OPTS);
    expect(th.text).toContain("ทีมผู้ดูแลตอบกลับแล้ว");
    expect(en.text).toContain("The support desk replied");
    expect(th.text).not.toContain("The support desk replied");
  });

  // The decision recorded in the plan: `pending` means "the work is done, please
  // confirm" in this system, NOT "we need more information from you". The Thai
  // wording has to say the former.
  it("calls Pending 'waiting for your confirmation', not 'waiting for information'", () => {
    // A real pending mail describes a ticket that IS pending, so the status
    // label and the headline both have to say the same thing.
    const pending: RequesterPayload = {
      ...requesterPayload,
      ticket: { ...ticket, displayStatus: "pending" },
    };
    const th = renderEmail("ticket.pending", pending, "th", OPTS);
    expect(th.text).toContain("รอยืนยันการปิด"); // the status label
    expect(th.text).toContain("รอคุณยืนยัน"); // the headline
    expect(th.text).not.toContain("รอข้อมูลเพิ่มเติม");

    const en = renderEmail("ticket.pending", pending, "en", OPTS);
    expect(en.text).toContain("Waiting for your confirmation");
    expect(en.text).not.toMatch(/waiting for (more )?information/i);
  });

  it("renders a Thai date in the Buddhist era, as the app already does", () => {
    const th = renderEmail("ticket.created", requesterPayload, "th", OPTS);
    expect(th.text).toMatch(/2569/);
  });

  it("has a translation for every event, in both languages", () => {
    expect(missingKeys("th")).toEqual([]);
    for (const event of EMAIL_EVENTS) {
      for (const lang of ["en", "th"] as const) {
        const { text } = renderEmail(event, staffPayload, lang, OPTS);
        // A missing key falls back to the key itself, which would show up here.
        expect(text).not.toContain(`headline.${event}`);
        expect(text).not.toContain(`body.${event}`);
      }
    }
  });
});

describe("HTML safety", () => {
  it("escapes user-written content in the HTML part", () => {
    const nasty: RequesterPayload = {
      ...requesterPayload,
      ticket: { ...ticket, subject: `<script>alert("x")</script>` },
      message: { authorName: "Mal <b>", body: "<img src=x onerror=1>" },
    };
    const { html } = renderEmail("comment.public_reply", nasty, "en", OPTS);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });
});
