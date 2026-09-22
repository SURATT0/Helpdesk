import { describe, expect, it } from "vitest";
import type { UploadedFile } from "../attachments/attachment.service";
import { validateIntakeAttachments } from "./intake-attachments";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

function file(overrides: Partial<UploadedFile> = {}): UploadedFile {
  return {
    originalname: "photo.png",
    mimetype: "image/png",
    size: PNG_BYTES.length,
    buffer: PNG_BYTES,
    ...overrides,
  };
}

describe("validateIntakeAttachments — everything decidable before a ticket exists", () => {
  it("accepts no files at all", () => {
    expect(validateIntakeAttachments([])).toEqual({ ok: true });
  });

  it("accepts a valid file within every limit", () => {
    expect(validateIntakeAttachments([file()])).toEqual({ ok: true });
  });

  it("rejects more files than MAX_FILES (default 5)", () => {
    const result = validateIntakeAttachments(Array.from({ length: 6 }, () => file()));
    expect(result).toEqual({ ok: false, reason: "too_many", max: 5 });
  });

  it("rejects a single file over MAX_FILE_MB (default 10MB)", () => {
    const result = validateIntakeAttachments([
      file({ size: 11 * 1024 * 1024 }),
    ]);
    expect(result).toEqual({
      ok: false,
      reason: "too_large",
      file: "photo.png",
      maxMb: 10,
    });
  });

  it("rejects a combined size over MAX_TOTAL_MB (default 25MB) even if no single file exceeds MAX_FILE_MB", () => {
    // Three files under the 10MB per-file cap but over 25MB combined.
    const result = validateIntakeAttachments([
      file({ size: 9 * 1024 * 1024 }),
      file({ size: 9 * 1024 * 1024, originalname: "b.png" }),
      file({ size: 9 * 1024 * 1024, originalname: "c.png" }),
    ]);
    expect(result).toEqual({ ok: false, reason: "total_too_large", maxMb: 25 });
  });

  it("rejects a file whose bytes don't match its declared type — the bytes win", () => {
    const result = validateIntakeAttachments([
      file({ buffer: Buffer.from("plain text, not a png") }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("unsupported_type");
  });

  it("accepts a declared type with no signature (text/csv, text/plain) when nothing contradicts it", () => {
    const result = validateIntakeAttachments([
      file({
        originalname: "notes.txt",
        mimetype: "text/plain",
        buffer: Buffer.from("just some notes"),
        size: 15,
      }),
    ]);
    expect(result).toEqual({ ok: true });
  });

  it("rejects a declared type outside the allowlist entirely", () => {
    const result = validateIntakeAttachments([
      file({
        originalname: "run.exe",
        mimetype: "application/x-msdownload",
        buffer: Buffer.from([0x4d, 0x5a, 0, 0]), // MZ header
        size: 4,
      }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("unsupported_type");
  });
});
