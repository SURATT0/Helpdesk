import { describe, it, expect } from "vitest";
import { parseCsv, parseImportCsv, IMPORT_COLUMNS } from "./csv";

describe("parseCsv", () => {
  it("parses a simple grid", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseCsv('subject,note\n"Printer, jammed",urgent')).toEqual([
      ["subject", "note"],
      ["Printer, jammed", "urgent"],
    ]);
  });

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('a\n"line one\nline two"')).toEqual([
      ["a"],
      ["line one\nline two"],
    ]);
  });

  it('unescapes doubled "" quotes', () => {
    expect(parseCsv('a\n"she said ""hi"""')).toEqual([
      ["a"],
      ['she said "hi"'],
    ]);
  });

  it("flushes a final row that lacks a trailing newline", () => {
    expect(parseCsv("a,b")).toEqual([["a", "b"]]);
  });

  it("normalises \\r\\n and bare \\r line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("drops fully-blank lines (e.g. a trailing newline)", () => {
    expect(parseCsv("a,b\n1,2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });
});

describe("parseImportCsv", () => {
  const header = "subject,description,priority,category,requesterEmail";

  it("maps a canonical header and returns data rows without the header", () => {
    const res = parseImportCsv(`${header}\nPrinter down,It broke,high,Hardware,a@acme.com`);
    expect(res.columns).toEqual({
      subject: 0,
      description: 1,
      priority: 2,
      category: 3,
      requesterEmail: 4,
    });
    expect(res.missingColumns).toEqual([]);
    expect(res.rows).toEqual([
      ["Printer down", "It broke", "high", "Hardware", "a@acme.com"],
    ]);
  });

  it("accepts header aliases (title/desc/email) case- and space-insensitively", () => {
    const res = parseImportCsv("Title, Desc ,Priority,Category,Email\nx,y,low,Software,b@acme.com");
    expect(res.columns).toEqual({
      subject: 0,
      description: 1,
      priority: 2,
      category: 3,
      requesterEmail: 4,
    });
    expect(res.missingColumns).toEqual([]);
  });

  it("reports missing columns when the header is incomplete", () => {
    const res = parseImportCsv("subject,priority\nPrinter down,high");
    expect(res.columns).toEqual({ subject: 0, priority: 1 });
    expect(res.missingColumns).toEqual(["description", "category", "requesterEmail"]);
  });

  it("keeps the first index when a column appears twice", () => {
    const res = parseImportCsv("subject,subject\na,b");
    expect(res.columns.subject).toBe(0);
  });

  it("treats a whole file as missing every column when empty", () => {
    const res = parseImportCsv("");
    expect(res.rows).toEqual([]);
    expect(res.columns).toEqual({});
    expect(res.missingColumns).toEqual([...IMPORT_COLUMNS]);
  });
});
