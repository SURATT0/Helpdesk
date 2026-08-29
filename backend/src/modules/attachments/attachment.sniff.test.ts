import { describe, expect, it } from "vitest";
import {
  dangerousKind,
  isRenderableImage,
  RENDERABLE_MIMES,
  sniff,
  verifyUpload,
} from "./attachment.sniff";

/** Real signature prefixes, padded so length checks behave like a real file. */
const bytes = (...prefix: number[]) =>
  Buffer.concat([Buffer.from(prefix), Buffer.alloc(64)]);

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04);
const EXE = bytes(0x4d, 0x5a, 0x90, 0x00);
const ELF = bytes(0x7f, 0x45, 0x4c, 0x46);
const SHEBANG = Buffer.from("#!/bin/sh\nrm -rf /\n");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
const CSV = Buffer.from("id,name\n1,Dana\n");

const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP"),
  Buffer.alloc(32),
]);

const ALLOWED = new Set([
  ...RENDERABLE_MIMES,
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
]);

describe("sniff", () => {
  it("identifies the four renderable image formats", () => {
    expect(sniff(PNG)).toMatchObject({ mime: "image/png", ext: "png" });
    expect(sniff(JPEG)).toMatchObject({ mime: "image/jpeg", ext: "jpg" });
    expect(sniff(GIF)).toMatchObject({ mime: "image/gif", ext: "gif" });
    expect(sniff(WEBP)).toMatchObject({ mime: "image/webp", ext: "webp" });
  });

  it("checks both halves of a WEBP header, not just RIFF", () => {
    // A RIFF container can hold WAV or AVI. Matching on "RIFF" alone would
    // accept either as an image.
    const riffWav = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.alloc(4),
      Buffer.from("WAVE"),
      Buffer.alloc(32),
    ]);
    expect(sniff(riffWav)).toBeNull();
  });

  it("identifies documents but does not mark them renderable", () => {
    expect(sniff(PDF)).toMatchObject({ mime: "application/pdf", renderable: false });
    expect(sniff(ZIP)).toMatchObject({ renderable: false });
  });

  it("returns null for a file with no signature at all", () => {
    // A genuine CSV lands here. Null means "unknown", never "safe to render".
    expect(sniff(CSV)).toBeNull();
  });

  it("does not identify SVG, so nothing can treat it as an image", () => {
    expect(sniff(SVG)).toBeNull();
  });

  it("survives a buffer shorter than the signatures it checks", () => {
    expect(sniff(Buffer.from([0x89]))).toBeNull();
    expect(sniff(Buffer.alloc(0))).toBeNull();
  });
});

describe("dangerousKind", () => {
  it("recognises executables and scripts whatever they are named", () => {
    expect(dangerousKind(EXE)).toBe("Windows executable");
    expect(dangerousKind(ELF)).toBe("ELF executable");
    expect(dangerousKind(SHEBANG)).toBe("script with a shebang");
  });

  it("leaves ordinary files alone", () => {
    expect(dangerousKind(PNG)).toBeNull();
    expect(dangerousKind(CSV)).toBeNull();
  });
});

describe("verifyUpload", () => {
  const check = (buffer: Buffer, declaredType: string) =>
    verifyUpload({ buffer, declaredType, allowed: ALLOWED });

  it("accepts a PNG that says it is a PNG", () => {
    expect(check(PNG, "image/png")).toEqual({
      ok: true,
      mime: "image/png",
      ext: "png",
    });
  });

  it("refuses an executable renamed to .png — the headline case", () => {
    const res = check(EXE, "image/png");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("Windows executable");
  });

  it("refuses an image type whose bytes are a different image", () => {
    // Not dangerous, but a mislabel: either an accident worth reporting, or a
    // deliberate one worth stopping. Either way it must not be stored as PNG and
    // later served with that type.
    const res = check(JPEG, "image/png");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("image/jpeg");
  });

  it("refuses an image claim with no image signature", () => {
    const res = check(CSV, "image/png");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("no image signature");
  });

  it("refuses an SVG even when it is declared as one", () => {
    // Belt and braces: SVG is not in the allowlist, and its bytes are not
    // identifiable as an image either, so both paths refuse it.
    const res = check(SVG, "image/svg+xml");
    expect(res.ok).toBe(false);
  });

  it("stores an image declared as a document as the image it is", () => {
    // Harmless in itself, but the stored type is what it will later be served
    // with, so it has to be the truth.
    expect(check(PNG, "application/pdf")).toEqual({
      ok: true,
      mime: "image/png",
      ext: "png",
    });
  });

  it("lets a signature-less text type through on its declared type", () => {
    expect(check(CSV, "text/csv")).toEqual({
      ok: true,
      mime: "text/csv",
      ext: "csv",
    });
  });

  it("refuses an unidentifiable file whose declared type is not allowed", () => {
    const res = check(CSV, "application/x-sh");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("Unsupported file type");
  });

  it("refuses a recognised type that is not on the allowlist", () => {
    const res = verifyUpload({
      buffer: PDF,
      declaredType: "application/pdf",
      allowed: new Set(["image/png"]),
    });
    expect(res.ok).toBe(false);
  });
});

describe("isRenderableImage", () => {
  it("admits exactly the four formats the thread draws", () => {
    for (const mime of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(isRenderableImage(mime)).toBe(true);
    }
  });

  it("refuses SVG and every document type", () => {
    // The rule a stored SVG relies on: it is a download card everywhere, on
    // every surface, because one function answers the question.
    expect(isRenderableImage("image/svg+xml")).toBe(false);
    expect(isRenderableImage("application/pdf")).toBe(false);
    expect(isRenderableImage("text/csv")).toBe(false);
  });
});
