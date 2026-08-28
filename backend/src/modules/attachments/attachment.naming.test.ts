import { describe, expect, it } from "vitest";
import {
  buildDisplayName,
  decodeUploadName,
  DISPLAY_NAME_MAX,
  formatSequence,
  slugify,
  SLUG_MAX,
  storageKeyFor,
  thumbKeyFor,
} from "./attachment.naming";

describe("slugify", () => {
  it("turns spaces into single dashes", () => {
    expect(slugify("error screen.png")).toBe("error-screen");
    expect(slugify("two   wide   gaps.png")).toBe("two-wide-gaps");
  });

  it("keeps Thai characters instead of transliterating them", () => {
    // The point of the slug is that the uploader still recognises the file.
    // "phaap-naa-cho" is recognisable to nobody.
    expect(slugify("ภาพหน้าจอ.png")).toBe("ภาพหน้าจอ");
    expect(slugify("ภาพหน้าจอ error.png")).toBe("ภาพหน้าจอ-error");
  });

  it("strips path separators so a name cannot climb out of anything", () => {
    expect(slugify("../../etc/passwd")).toBe("etcpasswd");
    expect(slugify("..\\..\\windows\\system32")).toBe("windowssystem32");
    expect(slugify("/absolute/path.png")).toBe("absolutepath");
  });

  it("strips the characters that would break a header or a filesystem", () => {
    expect(slugify('a"b<c>d|e:f*g?h.png')).toBe("abcdefgh");
  });

  it("strips control characters, which could split a header line", () => {
    expect(slugify("head\r\ninjected.png")).toBe("head-injected");
    expect(slugify("tab\tname.png")).toBe("tab-name");
  });

  it("falls back when nothing recognisable survives", () => {
    // `!` and `_` are legal filename characters, so they are not stripped — but a
    // slug made only of punctuation names nothing, so the fallback applies. The
    // test is "is there a letter or a digit in any script", not an ASCII check.
    expect(slugify("!!!.png")).toBe("attachment");
    expect(slugify("___")).toBe("attachment");
    expect(slugify("....")).toBe("attachment");
    expect(slugify("")).toBe("attachment");
    expect(slugify("   .png")).toBe("attachment");
  });

  it("keeps punctuation that sits alongside real content", () => {
    expect(slugify("my_file.png")).toBe("my_file");
    expect(slugify("v1.2_final.png")).toBe("v1.2_final");
  });

  it("never leads or trails with punctuation", () => {
    // A leading dot would make the file hidden on unix.
    expect(slugify("-leading.png")).toBe("leading");
    expect(slugify(".hidden.png")).toBe("hidden");
    expect(slugify("trailing-.png")).toBe("trailing");
  });

  it("cuts at the slug limit and does not leave a dangling dash", () => {
    expect(slugify(`${"a".repeat(200)}.png`)).toHaveLength(SLUG_MAX);
    // The 40th character lands on a dash here; the tail is trimmed after cutting.
    const cut = slugify(`${"a".repeat(39)} tail.png`);
    expect(cut).toBe("a".repeat(39));
    expect(cut.endsWith("-")).toBe(false);
  });

  it("only treats an ASCII suffix as an extension", () => {
    // "รายงาน.เดือน" is a name with a dot in it, not a name plus an extension.
    expect(slugify("รายงาน.เดือน")).toBe("รายงาน.เดือน");
    expect(slugify("report.png")).toBe("report");
  });
});

describe("formatSequence", () => {
  it("pads to two digits up to 99", () => {
    expect(formatSequence(1)).toBe("01");
    expect(formatSequence(9)).toBe("09");
    expect(formatSequence(99)).toBe("99");
  });

  it("widens to three digits past 99 rather than wrapping or truncating", () => {
    expect(formatSequence(100)).toBe("100");
    expect(formatSequence(999)).toBe("999");
    // Beyond three digits it simply grows — still unique, which is the property
    // that matters more than the width.
    expect(formatSequence(1000)).toBe("1000");
  });

  it("produces a distinct string for every sequence around the boundary", () => {
    const seen = new Set<string>();
    for (let i = 90; i <= 110; i++) seen.add(formatSequence(i));
    expect(seen.size).toBe(21);
  });
});

describe("buildDisplayName", () => {
  it("builds T<ticket>-<seq>-<slug>.<ext>", () => {
    expect(
      buildDisplayName({
        ticketId: 1046,
        sequence: 1,
        originalName: "error screen.png",
        ext: "png",
      }),
    ).toBe("T1046-01-error-screen.png");
  });

  it("numbers the second file in a ticket 02", () => {
    expect(
      buildDisplayName({
        ticketId: 1046,
        sequence: 2,
        originalName: "second.png",
        ext: "png",
      }),
    ).toBe("T1046-02-second.png");
  });

  it("carries a Thai name through intact", () => {
    expect(
      buildDisplayName({
        ticketId: 1046,
        sequence: 1,
        originalName: "ภาพหน้าจอ.png",
        ext: "png",
      }),
    ).toBe("T1046-01-ภาพหน้าจอ.png");
  });

  it("uses the fallback slug when the name has nothing in it", () => {
    expect(
      buildDisplayName({
        ticketId: 1046,
        sequence: 1,
        originalName: "!!!.png",
        ext: "png",
      }),
    ).toBe("T1046-01-attachment.png");
  });

  it("stays within the cap for an absurdly long name", () => {
    const name = buildDisplayName({
      ticketId: 1046,
      sequence: 1,
      originalName: `${"a".repeat(200)}.png`,
      ext: "png",
    });
    expect(name.length).toBeLessThanOrEqual(DISPLAY_NAME_MAX);
    // The slug is what gives way — the prefix identifies the file and the
    // extension tells the reader what it is, so neither may be shortened.
    expect(name.startsWith("T1046-01-")).toBe(true);
    expect(name.endsWith(".png")).toBe(true);
  });

  it("keeps the prefix and extension even when the id eats the whole budget", () => {
    const name = buildDisplayName({
      ticketId: Number("1".repeat(95)),
      sequence: 1,
      originalName: "whatever.png",
      ext: "png",
    });
    expect(name.length).toBeLessThanOrEqual(DISPLAY_NAME_MAX);
  });

  it("takes the extension from the caller, never from the uploader's name", () => {
    // The caller passes the VERIFIED extension. A name claiming .exe cannot put
    // that suffix on the stored display name.
    expect(
      buildDisplayName({
        ticketId: 7,
        sequence: 1,
        originalName: "payload.exe",
        ext: "png",
      }),
    ).toBe("T7-01-payload.png");
  });
});

describe("storageKeyFor", () => {
  it("contains nothing but the random part and a verified extension", () => {
    expect(storageKeyFor("png", "deadbeef")).toBe("attachments/deadbeef.png");
  });

  it("carries no ticket id", () => {
    // A key that encodes what it holds turns a guessed key into a way to
    // enumerate a customer's tickets.
    const key = storageKeyFor("png", "abc123");
    expect(key).not.toMatch(/\d{4}/);
    expect(key).not.toContain("tickets/");
  });

  it("drops an extension that is not a plain lowercase token", () => {
    // Defence in depth: the caller already passes a verified extension, but a
    // key builder that would accept "../evil" is one refactor from being handed
    // one.
    expect(storageKeyFor("../evil", "abc")).toBe("attachments/abc");
    expect(storageKeyFor("p n g", "abc")).toBe("attachments/abc");
    expect(storageKeyFor("PNG", "abc")).toBe("attachments/abc");
  });
});

describe("thumbKeyFor", () => {
  it("inserts the marker before the extension", () => {
    expect(thumbKeyFor("attachments/abc.png")).toBe("attachments/abc-thumb.png");
  });

  it("appends when there is no extension", () => {
    expect(thumbKeyFor("attachments/abc")).toBe("attachments/abc-thumb");
  });

  it("is not fooled by a dot in a directory name", () => {
    expect(thumbKeyFor("a.b/abc")).toBe("a.b/abc-thumb");
  });
});

describe("decodeUploadName", () => {
  it("recovers a Thai name that busboy handed over as latin1", () => {
    // Exactly what arrives from a browser upload: UTF-8 bytes read as latin1.
    const mangled = Buffer.from("ภาพหน้าจอ.png", "utf8").toString("latin1");
    expect(mangled).not.toBe("ภาพหน้าจอ.png"); // the bug being fixed
    expect(decodeUploadName(mangled)).toBe("ภาพหน้าจอ.png");
  });

  it("leaves an ASCII name exactly as it was", () => {
    expect(decodeUploadName("error screen.png")).toBe("error screen.png");
  });

  it("keeps the original when the bytes are not UTF-8 after all", () => {
    // A lone high byte is not valid UTF-8; replacing a readable name with
    // question marks would be worse than leaving it.
    const notUtf8 = "café-ÿ.png";
    expect(decodeUploadName(notUtf8)).toBe(notUtf8);
  });

  it("is idempotent for a name that is already correct", () => {
    const once = decodeUploadName("report.png");
    expect(decodeUploadName(once)).toBe(once);
  });
});
