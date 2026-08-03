import { describe, it, expect } from "vitest";
import {
  parseEmailAddress,
  derivePriority,
  normalizeInbound,
  parseTicketRef,
  ensureTicketRef,
  ticketRef,
} from "./email.parsers";

describe("parseEmailAddress", () => {
  it("parses a bare address and lower-cases it", () => {
    expect(parseEmailAddress("DANA@ACME.COM")).toEqual({ email: "dana@acme.com" });
  });

  it("parses a display-name form into name + address", () => {
    expect(parseEmailAddress("Dana Reyes <Dana@Acme.com>")).toEqual({
      name: "Dana Reyes",
      email: "dana@acme.com",
    });
  });

  it("handles a quoted display name", () => {
    expect(parseEmailAddress('"Dana Reyes" <dana@acme.com>')).toEqual({
      name: "Dana Reyes",
      email: "dana@acme.com",
    });
  });

  it("omits the name when the angle form has none", () => {
    expect(parseEmailAddress("<dana@acme.com>")).toEqual({ email: "dana@acme.com" });
  });

  it("trims surrounding whitespace", () => {
    expect(parseEmailAddress("  dana@acme.com  ")).toEqual({ email: "dana@acme.com" });
  });
});

describe("derivePriority", () => {
  it("defaults to medium and trims when there is no tag", () => {
    expect(derivePriority("  Printer is down  ")).toEqual({
      priority: "medium",
      subject: "Printer is down",
    });
  });

  it("maps [urgent] to critical and strips the tag", () => {
    expect(derivePriority("[urgent] Server on fire")).toEqual({
      priority: "critical",
      subject: "Server on fire",
    });
  });

  it("passes through a recognised priority tag, case-insensitively", () => {
    expect(derivePriority("[HIGH] Login broken")).toEqual({
      priority: "high",
      subject: "Login broken",
    });
    expect(derivePriority("[low] Typo in footer")).toEqual({
      priority: "low",
      subject: "Typo in footer",
    });
  });

  it("does not treat an unknown bracket tag as a priority", () => {
    expect(derivePriority("[billing] Invoice question")).toEqual({
      priority: "medium",
      subject: "[billing] Invoice question",
    });
  });
});

describe("normalizeInbound", () => {
  it("normalises a SendGrid-style payload (from/subject/text)", () => {
    expect(
      normalizeInbound({
        from: "Marcus Chen <marcus@acme.com>",
        subject: "Cannot print",
        text: "The printer won't respond.",
      }),
    ).toEqual({
      from: "marcus@acme.com",
      fromName: "Marcus Chen",
      subject: "Cannot print",
      text: "The printer won't respond.",
    });
  });

  it("normalises a Mailgun-style payload (sender/body-plain)", () => {
    const r = normalizeInbound({
      sender: "kai@acme.com",
      subject: "VPN issue",
      "body-plain": "VPN keeps dropping.",
    });
    expect(r.from).toBe("kai@acme.com");
    expect(r.text).toBe("VPN keeps dropping.");
  });

  it("reads the sender out of a stringified envelope when from/sender are absent", () => {
    const r = normalizeInbound({
      envelope: JSON.stringify({ from: "ivy@acme.com" }),
      subject: "Access request",
      body: "Please grant access.",
    });
    expect(r.from).toBe("ivy@acme.com");
    expect(r.text).toBe("Please grant access.");
  });

  it("falls back to a placeholder subject when none is given", () => {
    const r = normalizeInbound({ from: "a@acme.com", text: "hi" });
    expect(r.subject).toBe("(no subject)");
  });

  it("throws when there is no From address", () => {
    expect(() => normalizeInbound({ subject: "x", text: "y" })).toThrow();
  });

  it("throws when the From value is not a valid email", () => {
    expect(() => normalizeInbound({ from: "not-an-email", text: "y" })).toThrow();
  });

  it("picks up Message-ID and In-Reply-To from top-level or headers", () => {
    expect(
      normalizeInbound({
        from: "a@b.com",
        subject: "s",
        text: "t",
        "message-id": "<abc@mail>",
      }).messageId,
    ).toBe("<abc@mail>");
    expect(
      normalizeInbound({
        from: "a@b.com",
        subject: "s",
        text: "t",
        headers: { "in-reply-to": "<prev@mail>" },
      }).inReplyTo,
    ).toBe("<prev@mail>");
  });
});

describe("ensureTicketRef", () => {
  it("formats the tag consistently", () => {
    expect(ticketRef(9)).toBe("[#9]");
  });

  it("stamps a ref onto a subject that has none", () => {
    expect(ensureTicketRef("Re: Printer is down", 42)).toBe(
      "[#42] Re: Printer is down",
    );
  });

  it("does not duplicate a ref that is already correct", () => {
    expect(ensureTicketRef("[#42] Re: Printer is down", 42)).toBe(
      "[#42] Re: Printer is down",
    );
  });

  // A forwarded old thread must not hijack the ticket it quotes: the ref we
  // stamp goes first, so parseTicketRef reads ours.
  it("adds the right ref when the subject quotes a different ticket", () => {
    const subject = ensureTicketRef("[#7] old thread", 42);
    expect(subject).toBe("[#42] [#7] old thread");
    expect(parseTicketRef(subject).ticketId).toBe(42);
  });

  // The round trip is the contract: whatever goes out must come back readable,
  // or the reply opens a duplicate ticket instead of threading.
  it("round-trips through parseTicketRef", () => {
    const subject = ensureTicketRef("Cannot print", 1234);
    expect(parseTicketRef(subject)).toEqual({
      ticketId: 1234,
      subject: "Cannot print",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(ensureTicketRef("   spaced out   ", 3)).toBe("[#3] spaced out");
  });
});

describe("parseTicketRef", () => {
  it("finds the tag our own outbound replies emit", () => {
    // reply.service sends `Re: [#123] <subject>` — this is the round-trip case.
    expect(parseTicketRef("Re: [#1042] VPN drops")).toEqual({
      ticketId: 1042,
      subject: "Re: VPN drops",
    });
  });

  it("survives the prefixes mail clients pile on", () => {
    for (const s of [
      "RE: RE: [#7] thing",
      "Antwort: [#7] thing",
      "RE[2]: [#7] thing",
      "Fwd: Re: [#7] thing",
    ]) {
      expect(parseTicketRef(s).ticketId).toBe(7);
    }
  });

  it("returns null when there is no tag", () => {
    expect(parseTicketRef("Printer is broken")).toEqual({
      ticketId: null,
      subject: "Printer is broken",
    });
  });

  it("ignores things that merely look like a tag", () => {
    for (const s of ["[#] x", "[#abc] x", "[1042] x", "#1042 x", "[##1042] x"]) {
      expect(parseTicketRef(s).ticketId).toBeNull();
    }
  });

  it("rejects an id too long to be a real ticket", () => {
    // Guards against a subject crafted to overflow into an unsafe integer.
    expect(parseTicketRef("[#99999999999999999999] x").ticketId).toBeNull();
  });
});
