import { describe, it, expect } from "vitest";
import {
  parseEmailAddress,
  derivePriority,
  normalizeInbound,
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
});
